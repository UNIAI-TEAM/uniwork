{{- define "uniwork.image" -}}
{{- $img := . -}}
{{- if and $img.requireDigest (not $img.digest) -}}
{{- fail (printf "uniwork: %s image.digest is required (sha256:...)" $img.repository) -}}
{{- end -}}
{{- printf "%s/%s@%s" $img.registry $img.repository $img.digest -}}
{{- end -}}
