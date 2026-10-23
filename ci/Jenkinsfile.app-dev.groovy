#!/usr/bin/env groovy

/**
 * UniWork app-dev: build on agent 107.188, push dev-* tags, SSH to the
 * host that already has Postgres, Redis, MinIO, and LiveKit, then pull and up.
 * The host .env is never copied and never overwritten.
 * Production publishes a floating tag on these image names; this pipeline does not.
 */

pipeline {
  agent none

  options {
    disableConcurrentBuilds()
    timeout(time: 150, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timestamps()
  }

  parameters {
    string(name: 'BRANCH', defaultValue: 'develop', description: 'Any branch is allowed. Default is develop.')
    string(name: 'DEPLOY_HOST', defaultValue: '113.20.107.188', description: 'SSH host that runs the containers')
    string(name: 'DEPLOY_SSH_PORT', defaultValue: '2232', description: 'SSH port on the deploy host')
    string(name: 'DEPLOY_USER', defaultValue: 'root', description: 'SSH user')
    string(name: 'DEPLOY_DIR', defaultValue: '/home/devops/uniwork', description: 'Directory that already contains .env')
    string(name: 'SSH_CREDENTIALS_ID', defaultValue: 'ssh-107.188', description: 'Jenkins SSH private key credential')
    string(name: 'HARBOR_CREDENTIALS_ID', defaultValue: 'fsales.registry.harbor.id', description: 'Harbor credentials')
    string(name: 'GIT_CREDENTIALS_ID', defaultValue: 'git-synam141', description: 'Git credentials')
  }

  environment {
    REGISTRY = 'registry-harbor.ubos.vn/uniwork'
    DOCKER_BUILDKIT = '1'
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
              env.BUILD_DATE = sh(returnStdout: true, script: 'date +%Y%m%d%H%M').trim()
              env.IMAGE_TAG = "dev-${env.BUILD_DATE}-${env.GIT_COMMIT_SHORT}"
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
              sh 'echo "${REGISTRY_PASS}" | docker login registry-harbor.ubos.vn -u "${REGISTRY_USER}" --password-stdin'
            }
          }
        }

        stage('Build BE') {
          steps {
            sh '''
              set -e
              docker build \\
                --memory="${DOCKER_BUILD_MEMORY}" \\
                --memory-swap="${DOCKER_BUILD_MEMORY}" \\
                -t "${REGISTRY}/uniwork-be:${IMAGE_TAG}" \\
                -f server/Dockerfile ./server
              docker push "${REGISTRY}/uniwork-be:${IMAGE_TAG}"
            '''
          }
        }

        stage('Build FE') {
          steps {
            sh '''
              set -e
              file=deploy/app-dev/env/uniwork-fe.build.env
              api=$(grep -E '^NEXT_PUBLIC_API_URL=' "$file" | cut -d= -f2-)
              ws=$(grep -E '^NEXT_PUBLIC_WS_URL=' "$file" | cut -d= -f2-)
              app=$(grep -E '^NEXT_PUBLIC_APP_URL=' "$file" | cut -d= -f2-)
              if [ -z "$api" ] || [ -z "$ws" ] || [ -z "$app" ]; then
                echo "FAIL: NEXT_PUBLIC_* missing in $file" >&2
                exit 1
              fi
              docker build \\
                --memory="${DOCKER_BUILD_MEMORY}" \\
                --memory-swap="${DOCKER_BUILD_MEMORY}" \\
                --build-arg "NEXT_PUBLIC_API_URL=${api}" \\
                --build-arg "NEXT_PUBLIC_WS_URL=${ws}" \\
                --build-arg "NEXT_PUBLIC_APP_URL=${app}" \\
                -t "${REGISTRY}/uniwork-fe:${IMAGE_TAG}" \\
                -f apps/web/Dockerfile .
              docker push "${REGISTRY}/uniwork-fe:${IMAGE_TAG}"
            '''
          }
        }

        stage('Build Office Engine') {
          steps {
            sh '''
              set -e
              docker build \\
                -t "${REGISTRY}/uniwork-office-engine:${IMAGE_TAG}" \\
                -f apps/office-engine/Dockerfile .
              docker push "${REGISTRY}/uniwork-office-engine:${IMAGE_TAG}"
            '''
          }
        }

        stage('Write image tag') {
          steps {
            sh '''
              set -e
              mkdir -p target
              printf 'UNIWORK_IMAGE_TAG=%s\n' "${IMAGE_TAG}" > target/image.env
            '''
            stash name: 'app-dev-deploy', includes: 'deploy/app-dev/docker-compose.yml,deploy/app-dev/docker-compose.secrets.yml,deploy/app-dev/env/uniwork-be.env,deploy/app-dev/env/uniwork-fe.env,deploy/app-dev/env/uniwork-office-engine.env,target/image.env'
          }
        }
      }
    }

    stage('Deploy') {
      agent { label '107.188' }
      steps {
        unstash 'app-dev-deploy'
        withEnv([
          "DEPLOY_USER=${params.DEPLOY_USER}",
          "DEPLOY_HOST=${params.DEPLOY_HOST}",
          "DEPLOY_SSH_PORT=${params.DEPLOY_SSH_PORT}",
          "DEPLOY_DIR=${params.DEPLOY_DIR}",
        ]) {
          sshagent(credentials: ["${params.SSH_CREDENTIALS_ID}"]) {
            sh '''#!/bin/bash
              set -euo pipefail
              dest="${DEPLOY_USER}@${DEPLOY_HOST}"
              ssh -p "$DEPLOY_SSH_PORT" -o BatchMode=yes "$dest" "mkdir -p ${DEPLOY_DIR}/env"
              scp -P "$DEPLOY_SSH_PORT" -o BatchMode=yes deploy/app-dev/docker-compose.yml deploy/app-dev/docker-compose.secrets.yml "$dest:${DEPLOY_DIR}/"
              scp -P "$DEPLOY_SSH_PORT" -o BatchMode=yes \
                deploy/app-dev/env/uniwork-be.env \
                deploy/app-dev/env/uniwork-fe.env \
                deploy/app-dev/env/uniwork-office-engine.env \
                target/image.env \
                "$dest:${DEPLOY_DIR}/env/"
            '''
            withCredentials([usernamePassword(
              credentialsId: "${params.HARBOR_CREDENTIALS_ID}",
              usernameVariable: 'REGISTRY_USER',
              passwordVariable: 'REGISTRY_PASS'
            )]) {
              sh '''#!/bin/bash
                set -euo pipefail
                dest="${DEPLOY_USER}@${DEPLOY_HOST}"
                # Unquoted EOF expands REGISTRY_* and DEPLOY_DIR locally.
                # Groovy consumes one backslash; the remaining backslash keeps $(mktemp) and $cfg for the remote shell.
                ssh -p "$DEPLOY_SSH_PORT" -o BatchMode=yes "$dest" "bash -s" <<EOF
set -euo pipefail
cfg=\\$(mktemp -d)
trap 'rm -rf "\\$cfg"' EXIT
export DOCKER_CONFIG="\\$cfg"
docker login registry-harbor.ubos.vn -u '${REGISTRY_USER}' --password-stdin <<'PW'
${REGISTRY_PASS}
PW
cd '${DEPLOY_DIR}'
docker compose -f docker-compose.yml --env-file env/image.env pull
docker compose -f docker-compose.yml -f docker-compose.secrets.yml --env-file env/image.env --env-file .env up -d
EOF
              '''
            }
          }
        }
      }
    }
  }
}
