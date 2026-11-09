# Deploying the Real-Time Location Tracker

Target: an Ubuntu 22.04/24.04 VPS with a domain pointing at it (an `A` record for `tracker.example.com` → server IP).

Stack: **Node.js 22 + PM2** (keeps the app alive) behind **Nginx** (HTTPS + WebSocket proxy) with a **Let's Encrypt** certificate.

> HTTPS is required. Browsers block `navigator.geolocation` on plain `http://` (except `localhost`), so without a certificate the map loads but nobody's location is ever shared.

---

## 1. Prepare the server

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git ufw

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# Firewall: only SSH + HTTP/HTTPS are public. Port 3000 stays closed, so Node is reachable only through nginx.
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 2. Get the code

```bash
sudo mkdir -p /var/www && sudo chown $USER:$USER /var/www
cd /var/www
git clone https://github.com/CaptainArslan/real-time-location-tracker.git
cd real-time-location-tracker
npm ci --omit=dev
```

> If you clone to a different path, update `root` in the `location ~ ^/(css|js|assets)/` block of the nginx config.

## 3. Start the app with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup          # run the command it prints, so the app starts on reboot
curl -I http://127.0.0.1:3000   # should return HTTP/1.1 200 OK
```

## 4. Get an SSL certificate

```bash
sudo apt install -y certbot
sudo certbot certonly --nginx -d tracker.example.com
```

(The default nginx site answers the challenge here. Certbot sets up auto-renewal; check it with `sudo certbot renew --dry-run`.)

## 5. Configure Nginx

```bash
# replace the domain everywhere in the file first
sed -i 's/tracker.example.com/YOUR.DOMAIN/g' deploy/nginx/location-tracker.conf

sudo cp deploy/nginx/location-tracker.conf /etc/nginx/sites-available/location-tracker
sudo ln -s /etc/nginx/sites-available/location-tracker /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Open `https://YOUR.DOMAIN`, allow location access, then open the same URL on a second device. Both markers should appear.

To make certbot reload nginx after each renewal:

```bash
echo -e '#!/bin/sh\nsystemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

## 6. Deploying updates

```bash
cd /var/www/real-time-location-tracker
git pull
npm ci --omit=dev
pm2 reload location-tracker
```

## Useful commands

| Task | Command |
|---|---|
| App logs | `pm2 logs location-tracker` |
| App status | `pm2 status` |
| Restart app | `pm2 restart location-tracker` |
| Nginx errors | `sudo tail -f /var/log/nginx/location-tracker.error.log` |
| Test nginx config | `sudo nginx -t` |

## Troubleshooting

- **502 Bad Gateway**: the Node app isn't running or isn't on port 3000. Check `pm2 status` and `pm2 logs`.
- **Map loads but no marker / "User denied Geolocation"**: you're on `http://`, or the browser's location permission is blocked.
- **Socket keeps reconnecting / falls back to polling**: the `/socket.io/` block is missing the `Upgrade`/`Connection` headers, or a CDN/proxy (e.g. Cloudflare) in front has WebSockets disabled.
- **Don't raise PM2 `instances` above 1**: Socket.IO would need sticky sessions and a Redis adapter for that.
