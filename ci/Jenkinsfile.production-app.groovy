#!/usr/bin/env groovy

/**
 * UniWork production-app: build develop → Harbor push → human approve →
 * Helm digest rollout on reap-eng-prod-k8s.
 *
 * Split agents:
 *   107.188          — checkout, docker build/push, write target/rollout.env
 *   production-k8s   — helm + kubectl against reap-eng-prod-k8s
 */

pipeline {
  agent none

  options {
    disableConcurrentBuilds()
    timeout(time: 90, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timestamps()
  }

  parameters {
    string(
      name: 'BRANCH',
      defaultValue: 'develop',
      description: 'Must be develop for production-app'
    )
    booleanParam(
      name: 'DEPLOY',
      defaultValue: true,
      description: 'After approve, helm rollout when CLUSTER_APPLY_CONFIRM=reap-eng-prod-k8s'
    )
    string(
      name: 'CLUSTER_APPLY_CONFIRM',
      defaultValue: '',
      description: 'Leave empty for dry-run (build/push only). Set to reap-eng-prod-k8s to mutate production.'
    )
    string(
      name: 'GIT_CREDENTIALS_ID',
      defaultValue: 'git-synam141',
      description: 'Jenkins credentials ID for Git checkout'
    )
    string(
      name: 'HARBOR_CREDENTIALS_ID',
      defaultValue: 'fsales.registry.harbor.id',
      description: 'Jenkins Harbor credentials (never hardcode secrets)'
    )
  }

  environment {
    REGISTRY            = 'registry-harbor.ubos.vn/uniwork'
    DOCKER_BUILDKIT     = '1'
    DOCKER_BUILD_MEMORY = '2g'
  }

  stages {

    stage('Build images') {
      agent { label '107.188' }
      stages {

        stage('Checkout') {
          steps {
            checkout([
              $class: 'GitSCM',
              branches: [[name: "*/${params.BRANCH}"]],
              extensions: [[$class: 'CleanBeforeCheckout']],
              userRemoteConfigs: [[
                url: scm.userRemoteConfigs[0].url,
                credentialsId: "${params.GIT_CREDENTIALS_ID}"
              ]]
            ])
            script {
              env.GIT_COMMIT_SHORT = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
              env.BUILD_DATE       = sh(returnStdout: true, script: 'date +%Y%m%d%H%M').trim()
              env.IMAGE_TAG        = "${env.BUILD_DATE}-${env.GIT_COMMIT_SHORT}"
            }
            sh 'chmod +x ci/scripts/*.sh ci/scripts/lib/*.sh || true'
          }
        }

        stage('Guard') {
          steps {
            script {
              if (params.BRANCH != 'develop') {
                error("production-app refuses BRANCH=${params.BRANCH}; use develop")
              }
            }
          }
        }

        stage('Registry Login') {
          steps {
            withCredentials([usernamePassword(
              credentialsId: "${params.HARBOR_CREDENTIALS_ID}",
              usernameVariable: 'REGISTRY_USER',
              passwordVariable: 'REGISTRY_PASS'
            )]) {
              sh 'echo "${REGISTRY_PASS}" | docker login ${REGISTRY} -u "${REGISTRY_USER}" --password-stdin'
            }
          }
        }

        stage('Build BE') {
          steps {
            script {
              def serviceTag = 'uniwork-be'
              def imageName = "${env.REGISTRY}/${serviceTag}:${env.IMAGE_TAG}"
              sh """
                docker build \\
                  --memory=${env.DOCKER_BUILD_MEMORY} \\
                  --memory-swap=${env.DOCKER_BUILD_MEMORY} \\
                  -t ${imageName} \\
                  -f server/Dockerfile ./server
              """
              pushImage(imageName, serviceTag)
            }
          }
        }

        stage('Build FE') {
          steps {
            script {
              def serviceTag = 'uniwork-fe'
              def imageName = "${env.REGISTRY}/${serviceTag}:${env.IMAGE_TAG}"
              sh """
                docker build \\
                  --memory=${env.DOCKER_BUILD_MEMORY} \\
                  --memory-swap=${env.DOCKER_BUILD_MEMORY} \\
                  --build-arg NEXT_PUBLIC_API_URL=https://uniwork.unicomhub.com \\
                  --build-arg NEXT_PUBLIC_WS_URL=wss://uniwork.unicomhub.com \\
                  --build-arg NEXT_PUBLIC_APP_URL=https://uniwork.unicomhub.com \\
                  -t ${imageName} \\
                  -f apps/web/Dockerfile .
              """
              pushImage(imageName, serviceTag)
            }
          }
        }

        stage('Prepare rollout') {
          steps {
            script {
              def beDigestFile = 'target/digests/uniwork-be.digest'
              def feDigestFile = 'target/digests/uniwork-fe.digest'
              if (!fileExists(beDigestFile)) {
                error("missing digest file after push (${beDigestFile})")
              }
              if (!fileExists(feDigestFile)) {
                error("missing digest file after push (${feDigestFile})")
              }
              def beDigest = readFile(beDigestFile).trim()
              def feDigest = readFile(feDigestFile).trim()
              if (!beDigest.startsWith('sha256:')) {
                error("invalid BE digest: ${beDigest}")
              }
              if (!feDigest.startsWith('sha256:')) {
                error("invalid FE digest: ${feDigest}")
              }
              def imageTag = env.IMAGE_TAG ?: ''
              writeFile file: 'target/rollout.env', text: """export IMAGE_TAG=${imageTag}
export BE_DIGEST=${beDigest}
export FE_DIGEST=${feDigest}
"""
              echo "IMAGE_TAG=${imageTag}"
              echo "BE_DIGEST=${beDigest}"
              echo "FE_DIGEST=${feDigest}"
            }
            stash name: 'prod-app-rollout', includes: 'target/**,deploy/app/uniwork/**,deploy/app/env/**,ci/scripts/**'
            sh '''
              set -e
              echo "=== 107.188 inventory (helm/kubectl are NOT used on this agent) ==="
              command -v docker
              command -v git
              if [ ! -f target/rollout.env ]; then
                echo "FAIL: missing target/rollout.env after Prepare" >&2
                exit 1
              fi
              . ./target/rollout.env
              echo "IMAGE_TAG=${IMAGE_TAG:-}"
              echo "BE_DIGEST=${BE_DIGEST:-}"
              echo "FE_DIGEST=${FE_DIGEST:-}"
              echo "OK: rollout.env written. Helm apply runs on production-k8s after Approve."
            '''
          }
        }

      } // nested stages on 107.188
      post {
        always {
          archiveArtifacts artifacts: 'target/digests/**,target/rollout.env', allowEmptyArchive: true
        }
      }
    } // Build images

    stage('Approve') {
      when {
        expression { return params.DEPLOY }
      }
      steps {
        input message: 'Deploy develop images to reap-eng-prod-k8s?', ok: 'Deploy'
      }
    }

    stage('Rollout') {
      agent { label 'production-k8s' }
      when {
        allOf {
          expression { return params.DEPLOY }
          expression { return params.CLUSTER_APPLY_CONFIRM == 'reap-eng-prod-k8s' }
        }
      }
      steps {
        unstash 'prod-app-rollout'
        sh """
          set -e
          echo "=== production-k8s inventory (required: kubectl, helm) ==="
          command -v kubectl
          if ! command -v helm >/dev/null 2>&1; then
            echo "FAIL: helm is not on PATH for this production-k8s agent (exit 127)." >&2
            exit 127
          fi
          helm version
          chmod +x ci/scripts/*.sh ci/scripts/lib/*.sh || true
          if [ ! -f target/rollout.env ]; then
            echo "FAIL: missing target/rollout.env after unstash" >&2
            ls -la target 2>/dev/null || true
            exit 1
          fi
          set -a
          . ./target/rollout.env
          set +a
          export CLUSTER_APPLY_CONFIRM="${params.CLUSTER_APPLY_CONFIRM}"
          ci/scripts/rollout-uniwork.sh
        """
      }
    }
  }

  post {
    always {
      echo 'production-app finished (artifacts archived on 107.188 if Build images ran)'
    }
    success {
      echo "production-app OK tag=${env.IMAGE_TAG}"
    }
    failure {
      echo 'production-app failed closed'
    }
  }
}

// Push version tag (rollback) and :latest; capture RepoDigest for Helm pin.
def pushImage(String imageName, String serviceTag) {
  def latestName = imageName.replaceAll(/:[^:]+$/, ':latest')
  sh """
    set -e
    docker push ${imageName}
    docker tag  ${imageName} ${latestName}
    docker push ${latestName}
    mkdir -p target/digests
    digest=\$(docker inspect --format='{{index .RepoDigests 0}}' ${imageName} | sed 's/.*@//')
    if [ -z "\${digest}" ]; then
      echo "FAIL: could not resolve RepoDigest for ${imageName}" >&2
      exit 1
    fi
    case "\${digest}" in
      sha256:*) ;;
      *)
        echo "FAIL: invalid digest for ${imageName}: \${digest}" >&2
        exit 1
        ;;
    esac
    printf '%s\\n' "\${digest}" > target/digests/${serviceTag}.digest
    echo "Pushed ${serviceTag} @ \${digest}"
  """
}
