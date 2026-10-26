# Host nginx for uniwork.unicomhub.com.
# Route split matches deploy/edge/route.yaml (uniwork-api, uniwork-mcp,
# uniwork-office-downloads, uniwork-web).
# Published ports are the app-dev compose mappings: API 8086, web 3008.

map $http_upgrade $uniwork_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name uniwork.unicomhub.com;

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
    server_name uniwork.unicomhub.com;

    ssl_certificate /etc/letsencrypt/live/uniwork.unicomhub.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/uniwork.unicomhub.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # DOCUMENT_MAX_BYTES is 200 MiB.
    client_max_body_size 200m;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_send_timeout 3600s;
    proxy_read_timeout 3600s;

    # uniwork-api, websocket. Matches /api and /api/*.
    location = /api {
        proxy_pass http://127.0.0.1:8086;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $uniwork_connection_upgrade;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8086;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $uniwork_connection_upgrade;
        proxy_cache_bypass $http_upgrade;
    }

    # uniwork-mcp. Plain HTTP, not websocket.
    location = /mcp {
        proxy_pass http://127.0.0.1:8086;
    }

    location /oauth/ {
        proxy_pass http://127.0.0.1:8086;
    }

    location = /.well-known/oauth-protected-resource {
        proxy_pass http://127.0.0.1:8086;
    }

    location /.well-known/oauth-protected-resource/ {
        proxy_pass http://127.0.0.1:8086;
    }

    location = /.well-known/oauth-authorization-server {
        proxy_pass http://127.0.0.1:8086;
    }

    # uniwork-office-downloads: installers, the apt repository, the update
    # feed and releases.json come from the public-read downloads bucket, as in
    # deploy/edge/route.yaml. Ops replaces OFFICE_DOWNLOADS_S3_HOST and
    # OFFICE_DOWNLOADS_BUCKET at apply time; this must never point at the
    # user-data bucket. GET/HEAD only (limit_except GET allows HEAD), no
    # websocket.
    location /downloads/office/ {
        limit_except GET {
            deny all;
        }
        rewrite ^/downloads/office/(.*)$ /OFFICE_DOWNLOADS_BUCKET/$1 break;
        proxy_pass https://OFFICE_DOWNLOADS_S3_HOST;
        proxy_set_header Host OFFICE_DOWNLOADS_S3_HOST;
        proxy_ssl_server_name on;
        proxy_set_header Upgrade "";
        proxy_set_header Connection "";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_hide_header x-amz-request-id;
        proxy_hide_header x-amz-id-2;
        proxy_hide_header x-amz-version-id;
        proxy_hide_header x-amz-delete-marker;
        proxy_hide_header x-amz-storage-class;
        proxy_hide_header x-amz-server-side-encryption;
    }

    # uniwork-web, websocket.
    location / {
        proxy_pass http://127.0.0.1:3008;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $uniwork_connection_upgrade;
        proxy_cache_bypass $http_upgrade;
    }

    error_page 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }

    access_log /var/log/nginx/uniwork.unicomhub.com.access.log;
    error_log /var/log/nginx/uniwork.unicomhub.com.error.log;
}
