# ActiveCampaign Contact Sync API

## 1. Titulo del proyecto

ActiveCampaign Contact Sync API

## 2. Frase corta de valor del proyecto

Backend API generica para sincronizar contactos y suscribirlos a listas de ActiveCampaign sin hardcodear formularios ni listas.

## 3. Mini bloque tipo "Pensada para equipos que quieren..."

Pensada para equipos que quieren:

- reutilizar un unico endpoint en multiples frontends
- enviar `list_ids` desde frontend sin tocar backend cuando cambian listas
- mantener validaciones, idempotencia y anti-spam en un servicio simple
- correr en VPS con `systemd` y observabilidad por `journald`

## 4. Que resuelve

- Recibe datos de contacto y `list_ids`.
- Valida payload con Zod.
- Normaliza campos de entrada.
- Sincroniza (create/update) contacto en ActiveCampaign.
- Suscribe contacto a una o mas listas.
- Devuelve respuesta JSON uniforme de exito o error.

## 5. Casos de uso tipicos

- Landing pages con distintas listas destino.
- Formularios de performance marketing con UTM.
- Sitios con multiples paginas y un backend comun.
- Integraciones donde las listas cambian frecuentemente.

## 6. Stack

- Node.js
- TypeScript (strict)
- Express
- fetch nativo
- zod
- pino
- vitest

## 7. Inicio rapido

1. Instalar dependencias:

```bash
npm install
```

2. Crear `.env` desde `.env.example`.

3. Desarrollo:

```bash
npm run dev
```

4. Build y ejecucion:

```bash
npm run build
npm start
```

5. Tests:

```bash
npm test
```

## 8. Variables de entorno

Validadas con Zod en `src/config/env.ts`:

- `PORT`
- `NODE_ENV`
- `LOG_LEVEL`
- `ALLOWED_ORIGINS`
- `ACTIVECAMPAIGN_BASE_URL`
- `ACTIVECAMPAIGN_API_TOKEN`
- `REQUEST_TIMEOUT_MS`
- `RETRY_MAX_ATTEMPTS`
- `RETRY_INITIAL_MS`
- `RETRY_MAX_MS`
- `IDEMPOTENCY_TTL_MS`
- `IDEMPOTENCY_WAIT_MS`
- `BODY_LIMIT`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_PER_IP`
- `RATE_LIMIT_MAX_PER_EMAIL`

## 9. Seguridad

### Principios

- No confiar en datos del cliente.
- No aceptar origins no permitidos.
- Evitar duplicados por reintentos.
- Limitar abuso por IP/email.
- No exponer secretos en logs.

### Comportamiento actual

- CORS con allowlist por `ALLOWED_ORIGINS`.
- Trusted origin guard por `Origin` y `Referer`.
- `X-Idempotency-Key` obligatorio para `POST /contacts/sync-and-subscribe`.
- Rate limit en memoria por IP y email.
- Cooldown anti-spam de 10 segundos por email.
- Error handler central con contrato uniforme.

## 10. Endpoints

- `GET /health`
- `POST /contacts/sync-and-subscribe`

### GET /health

```json
{
  "ok": true,
  "service": "activecampaign-contact-sync-api",
  "version": "1.0.0",
  "environment": "production",
  "timestamp": "2026-04-10T12:00:00.000Z"
}
```

### POST /contacts/sync-and-subscribe

Headers requeridos:

- `Content-Type: application/json`
- `X-Idempotency-Key: <uuid>`
- `Origin` y/o `Referer` validos contra `ALLOWED_ORIGINS`

Body permitido:

```json
{
  "email": "user@example.com",
  "first_name": "Juan",
  "last_name": "Perez",
  "phone": "+54 9 11 1234 5678",
  "country": "Argentina",
  "consent": true,
  "list_ids": [1, 3, 7],
  "utm_source": "facebook",
  "utm_medium": "cpc",
  "utm_campaign": "mi-campania",
  "utm_content": "anuncio-1",
  "utm_term": "marketing",
  "page_url": "https://midominio.com/landing",
  "referrer": "https://google.com"
}
```

Reglas:

- `email` y `list_ids` son obligatorios.
- `list_ids` debe ser array no vacio de enteros positivos.
- `list_ids` se deduplica.
- No existen aliases ni mapeos formulario -> lista.

## 11. Contrato de respuesta

### Exito

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "action": "synced",
  "contact_id": 123,
  "subscribed_list_ids": [1, 3, 7],
  "meta": {},
  "warnings": []
}
```

### Error

```json
{
  "ok": false,
  "request_id": "req_xxx",
  "error": {
    "code": "validation_error",
    "message": "Invalid request body",
    "details": {}
  }
}
```

## 12. Idempotencia

- Header obligatorio: `X-Idempotency-Key` (UUID valido).
- Fingerprint: `method + path + body canonicalizado`.
- Misma key + mismo body: replay consistente.
- Misma key + body distinto: `409 idempotency_conflict`.
- Estado `in-progress` con espera configurable (`IDEMPOTENCY_WAIT_MS`).

## 13. Rate limiting / anti-spam

- Rate limit por IP (ventana: `RATE_LIMIT_WINDOW_MS`, max: `RATE_LIMIT_MAX_PER_IP`).
- Rate limit por email (ventana: `RATE_LIMIT_WINDOW_MS`, max: `RATE_LIMIT_MAX_PER_EMAIL`).
- Cooldown por email de 10 segundos.
- Todo en memoria (sin DB, sin Redis).

## 14. Observabilidad / logs

- Logging estructurado con Pino.
- Logs normales por `stdout`.
- Logs fatales por `stderr`.
- Preparado para `systemd` + `journald` sin archivos de log custom.

Campos de request log:

- `request_id`
- `method`
- `path`
- `status`
- `duration_ms`
- `origin`
- `result`
- `email_hash`

Eventos de runtime:

- `startup_complete`
- `startup_failed`
- `shutdown_started`
- `shutdown_complete`
- `uncaught_exception`
- `unhandled_rejection`

No se loggea:

- `ACTIVECAMPAIGN_API_TOKEN`
- headers sensibles completos
- payload completo sin redaccion

## 15. Codigos HTTP

- `200` OK
- `204` Preflight CORS
- `400` Validation / request invalido
- `403` Forbidden origin
- `404` Route not found
- `409` Idempotency conflict
- `429` Rate limit o cooldown
- `500` Internal server error
- `502` Provider error (ActiveCampaign)

## 16. Error codes frecuentes

- `validation_error`
- `forbidden_origin`
- `idempotency_conflict`
- `rate_limit_error`
- `provider_error`
- `not_found`
- `internal_error`

## 17. Ejemplos rapidos

### Smoke test `/health`

```bash
curl -i -s http://localhost:3000/health
```

Esperado:

- status `200`
- body con `ok: true`

### Smoke test `/contacts/sync-and-subscribe`

```bash
curl -i -s -X POST http://localhost:3000/contacts/sync-and-subscribe \
  -H "Content-Type: application/json" \
  -H "Origin: https://midominio.com" \
  -H "Referer: https://midominio.com/landing" \
  -H "X-Idempotency-Key: 1a0c1b7b-5b70-4f8e-9f95-a477f7f2b6da" \
  -d '{
    "email":"user@example.com",
    "first_name":"Juan",
    "list_ids":[1,3,7]
  }'
```

Esperado:

- status `200`
- body con `action: "synced"` y `subscribed_list_ids`

### Replay idempotente (opcional)

Repetir exactamente el request anterior con la misma key.  
Esperado: status `200` + header `X-Idempotent-Replay: true`.

## 18. Produccion

### Deployment checklist (corto y practico)

- [ ] `NODE_ENV=production`
- [ ] `LOG_LEVEL=info` o `warn`
- [ ] `ALLOWED_ORIGINS` seteado con origins reales (sin comodines)
- [ ] `ACTIVECAMPAIGN_BASE_URL` y `ACTIVECAMPAIGN_API_TOKEN` validos
- [ ] `npm ci && npm run build` ejecutado sin errores
- [ ] servicio gestionado por `systemd` con `Restart=on-failure`
- [ ] smoke tests de `/health` y `/contacts/sync-and-subscribe` ejecutados
- [ ] logs visibles por `journalctl`

## 19. Despliegue en VPS con systemd

1. Build:

```bash
npm ci
npm run build
```

2. Crear `EnvironmentFile`, por ejemplo:

`/etc/activecampaign-contact-sync.env`

3. Copiar unit file incluido en el repo:

`deploy/activecampaign-api.service`

Destino recomendado:

`/etc/systemd/system/activecampaign-api.service`

4. Comandos operativos:

```bash
sudo systemctl daemon-reload
sudo systemctl enable activecampaign-api
sudo systemctl restart activecampaign-api
sudo systemctl status activecampaign-api
```

## 20. Ejemplo completo de service file systemd

```ini
[Unit]
Description=ActiveCampaign Contact Sync API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/activecampaign-contact-sync-api
EnvironmentFile=/etc/activecampaign-contact-sync.env
ExecStart=/usr/bin/node /opt/activecampaign-contact-sync-api/dist/server.js
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Notas:

- `WorkingDirectory` debe apuntar al root de deploy.
- `ExecStart` debe apuntar a `dist/server.js`.
- `EnvironmentFile` debe incluir todas las variables requeridas.
- `Restart=on-failure` reinicia el proceso ante crash.
- `StandardOutput=journal` y `StandardError=journal` dejan logs en `journald`.

## 21. Como ver logs con journalctl

Seguir en vivo:

```bash
journalctl -u activecampaign-api -f
```

Forma generica:

```bash
journalctl -u <service> -f
```

Ultimas lineas:

```bash
journalctl -u activecampaign-api -n 200 --no-pager
```

Desde hoy:

```bash
journalctl -u activecampaign-api --since today
```

## 22. Limitaciones actuales

- Idempotencia y rate limit en memoria.
- No hay persistencia de estado tras reinicio.
- No hay soporte multi-instancia compartiendo limites.
- El rate limit por IP usa la IP observada por Node.js (`req.ip`); si hay reverse proxy, revisar topologia de red.
- Si falla una suscripcion a lista, la operacion falla.
- No cubre bulk import ni webhooks.

## 23. Notas de mantenimiento

- Ejecutar siempre:

```bash
npm run typecheck
npm test
```

- Revisar integracion ActiveCampaign si cambian endpoints/contratos.
- Mantener dependencias al dia.

Referencias oficiales ActiveCampaign usadas:

- `POST /contact/sync`: https://developers.activecampaign.com/reference/sync-a-contacts-data
- `POST /contactLists`: https://developers.activecampaign.com/reference/update-list-status-for-contact
