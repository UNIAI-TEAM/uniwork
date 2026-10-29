{{- define "uniwork.image" -}}
{{- $img := . -}}
{{- if and $img.requireDigest (not $img.digest) -}}
{{- fail (printf "uniwork: %s image.digest is required (sha256:...)" $img.repository) -}}
{{- end -}}
{{- printf "%s/%s@%s" $img.registry $img.repository $img.digest -}}
{{- end -}}

{{/* pool-app has no taint; pool-exam is dedicated=exam:NoSchedule. One term
     with operator In is OR across those two labels. */}}
{{- define "uniwork.nodeAffinity" -}}
nodeAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    nodeSelectorTerms:
      - matchExpressions:
          - key: workload
            operator: In
            values:
              {{- range .Values.scheduling.workloads }}
              - {{ . | quote }}
              {{- end }}
{{- end }}

{{- define "uniwork.tolerations" -}}
{{- with .Values.scheduling.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{- define "uniwork.avoidPostgres" -}}
podAntiAffinity:
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        topologyKey: kubernetes.io/hostname
        labelSelector:
          matchLabels:
            cluster-name: reap-postgresql
{{- end }}
