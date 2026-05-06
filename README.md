# Currency And Metals Converter

Small Node.js app for currency and metals conversion, packaged to run cleanly as a Docker container behind your main website.

## Recommended Deployment Shape

Run this project as its own container and route a subdomain to it, for example `currency.yoursite.com`.

This is the cleanest option because the app currently uses root-relative routes such as:

- `/currency`
- `/metals`
- `/api/currencies`
- `/convert`

That means subdomain routing is a better fit than mounting it under a nested path on your main portfolio site.

## Git Setup

This directory has been initialized as a local Git repository.

If you want to attach it to GitHub later:

```bash
git branch -m main
git remote add origin <your-repo-url>
git add .
git commit -m "Initial project import"
git push -u origin main
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your real API key:

```bash
cp .env.example .env
```

Use:

- `FREECURRENCY_API_KEY`: API key only, preferred
- `APP_PORT`: internal app port inside the container
- `HOST_PORT`: local host port exposed for your reverse proxy
- `CACHE_DIR`: persistent cache directory inside the container

Notes:

- `.env` is already ignored by Git
- the current checked-in `.env` should be treated as secret and rotated if those keys are real

## Run With Docker

Build and start:

```bash
docker compose up --build -d
```

Then the app will be available on:

```text
http://127.0.0.1:3000
```

If you change `HOST_PORT`, update your reverse proxy target to match.

Stop it with:

```bash
docker compose down
```

## Nginx Routing Example

Example config for `currency.yoursite.com`:

```nginx
server {
    listen 80;
    server_name currency.yoursite.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

An equivalent sample is included in `deploy/nginx/currency-converter.conf`.

## DNS And Site Integration

Typical setup:

1. Create a DNS record for `currency.yoursite.com` pointing to your server.
2. Run this container on the server with Docker Compose.
3. Configure Nginx or your existing reverse proxy to forward that hostname to `127.0.0.1:3000`.
4. Add a "Live Demo" link from your portfolio to `https://currency.yoursite.com`.

## Tests

Run tests with:

```bash
npm test
```
