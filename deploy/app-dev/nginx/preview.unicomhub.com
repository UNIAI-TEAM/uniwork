# Host nginx for preview.unicomhub.com.
# Route split matches deploy/edge/route.yaml (uniwork-preview-assets).
# Only the asset broker is reachable. HTML is never served on this host.

server {
    listen 80;
    listen [::]:80;
    server_name preview.unicomhub.com;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name preview.unicomhub.com;

    ssl_certificate /etc/letsencrypt/live/preview.unicomhub.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/preview.unicomhub.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    # Markdown and HTML frames on uniwork.unicomhub.com embed this origin.
    add_header Content-Security-Policy "frame-ancestors https://uniwork.unicomhub.com" always;

    client_max_body_size 200m;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_send_timeout 3600s;
    proxy_read_timeout 3600s;

    # uniwork-preview-assets → API. Matches /api/v1/preview/assets/*.
    location /api/v1/preview/assets/ {
        proxy_pass http://127.0.0.1:8086;
    }

    location / {
        return 404;
    }

    access_log /var/log/nginx/preview.unicomhub.com.access.log;
    error_log /var/log/nginx/preview.unicomhub.com.error.log;
}
