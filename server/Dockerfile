FROM golang:1.27.2-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server && \
    CGO_ENABLED=0 go build -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 go build -o /out/graph-rebuild ./cmd/graph-rebuild

FROM alpine:3.20
RUN adduser -D app
USER app
COPY --from=build /out/server /out/migrate /out/graph-rebuild /usr/local/bin/
EXPOSE 8080
CMD ["sh", "-c", "migrate up && server"]
