{{/* KEY=value parser; splitn preserves '=' in values. */}}
{{- define "uniwork.envFileData" -}}
{{- range $line := splitList "\n" . }}
{{- $t := trim $line }}
{{- if and $t (not (hasPrefix "#" $t)) (contains "=" $t) }}
{{- $kv := splitn "=" 2 $t }}
{{- $key := trim $kv._0 }}
{{- $val := trim $kv._1 }}
{{- if $key }}
{{ $key }}: {{ $val | quote }}
{{- end }}
{{- end }}
{{- end }}
{{- end -}}
