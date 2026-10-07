# Privacy-preserving deployment

Lightning Lens is a static application: deploy only the contents of [`public/`](../public/).
There is no backend, database, build output, or server-side processing.

The sample [`nginx.conf`](nginx.conf) serves the application with a restrictive Content Security
Policy, privacy-conscious access logs, and headers that prevent framing, referrer leakage, and
content-type sniffing. Review and adapt it to your environment rather than copying settings
blindly.

## Run with Docker

From the repository root:

```sh
docker run -d \
  --name lightning-lens \
  --restart unless-stopped \
  -p 8080:80 \
  -v "$PWD/public:/usr/share/nginx/html:ro" \
  -v "$PWD/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine
```

Open <http://localhost:8080>. Put an HTTPS reverse proxy in front before exposing the service to
the internet.

## Install on an existing nginx server

1. Copy `public/` to a web root, for example `/var/www/ln-bolt11-statistics`.
2. Copy `deploy/nginx.conf` into nginx's `conf.d` directory.
3. Change `root`, `listen`, and `server_name` for your environment.
4. Validate and reload:

   ```sh
   nginx -t && nginx -s reload
   ```

Configure HTTPS with your reverse proxy or certificate provider. Modern browsers require HTTP on
localhost or HTTPS in production for the module-worker setup; opening `index.html` through
`file://` does not work.

## Privacy and security properties

The sample configuration:

- serves static files only and returns `404` for unknown paths;
- permits scripts, styles, images, and workers only from the same origin;
- permits network requests only to the same origin and `mempool.space`;
- excludes query strings and the `Referer` header from access logs;
- prevents embedding in frames and disables unneeded browser capabilities; and
- forces asset revalidation so JavaScript modules and workers update together.

TLS termination and upstream proxy logs are outside this nginx configuration. Check that every
proxy or CDN in front of nginx also avoids logging sensitive query strings or referrers. The app
does not place invoices in URLs, but conservative logging remains useful defense in depth.

## Updating

Replace the files in the web root and keep the deployment atomic where practical. There is no
build step and no application process to restart. Reload nginx only when its configuration
changes.

After deployment, verify the status codes and headers:

```sh
curl -sI https://your-domain.example/
curl -sI https://your-domain.example/assets/app.js
curl -sI https://your-domain.example/assets/worker.js
curl -sI https://your-domain.example/does-not-exist  # should be 404
```

Finally, open the site and run the synthetic demo. Analysis must work without any automatic
third-party request; node enrichment should occur only after explicit confirmation.
