# ActiveCampaign API
API backend lista para produccion para sincronizar contactos y suscribirlos a listas de ActiveCampaign de forma segura y reutilizable.

Pensada para equipos que quieren:

- exponer una API limpia al frontend
- evitar exponer el token de ActiveCampaign
- usar `list_ids` dinamicos sin hardcodear listas en backend
- operar con idempotencia, rate limit y logs claros en VPS con systemd

## Que resuelve
Este proyecto encapsula el flujo de contactos en ActiveCampaign:

- validacion y normalizacion del payload
- sync de contacto (create/update) por email
- suscripcion del contacto a una o mas listas enviadas por frontend
- aplicacion opcional de etiquetas por `tag_ids`
- respuesta uniforme de exito y error
- protecciones minimas de seguridad, anti-spam e idempotencia

## Casos de uso tipicos

- formularios de registro en landings
- flujos de captacion con multiples listas de destino
- integraciones frontend donde las listas cambian seguido
- sitios con varias paginas y un backend comun

## Stack

- Node.js 20+
- TypeScript
- Express
- fetch nativo para llamadas a ActiveCampaign
- zod para validacion
- pino para logs estructurados
- vitest para tests

## Inicio rapido
Clonar repositorio, instalar dependencias, configurar `.env` y levantar API.

```bash
npm install
cp .env.example .env
npm run dev
```

Build para produccion:

```bash
npm run build
npm start
```

Tests:

```bash
npm test
```

## Variables de entorno

| Variable | Requerida | Default | Descripcion |
|---|---|---|---|
| `PORT` | No | `3000` | Puerto HTTP |
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production` |
| `LOG_LEVEL` | No | `info` | Nivel de logs |
| `ALLOWED_ORIGINS` | Si | - | Lista CSV de origenes permitidos |
| `ACTIVECAMPAIGN_BASE_URL` | Si | - | Base URL de ActiveCampaign |
| `ACTIVECAMPAIGN_API_TOKEN` | Si | - | Token API de ActiveCampaign (solo backend) |
| `REQUEST_TIMEOUT_MS` | No | `8000` | Timeout por request al proveedor |
| `RETRY_MAX_ATTEMPTS` | No | `3` | Reintentos en errores transitorios |
| `RETRY_INITIAL_MS` | No | `200` | Backoff inicial |
| `RETRY_MAX_MS` | No | `1500` | Backoff maximo |
| `IDEMPOTENCY_TTL_MS` | No | `3600000` | TTL del store de idempotencia |
| `IDEMPOTENCY_WAIT_MS` | No | `1500` | Espera maxima en estado in-progress |
| `BODY_LIMIT` | No | `100kb` | Limite de `express.json` |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Ventana de rate limit |
| `RATE_LIMIT_MAX_PER_IP` | No | `60` | Max requests por IP en ventana |
| `RATE_LIMIT_MAX_PER_EMAIL` | No | `20` | Max requests por email en ventana |

## Seguridad

### Principios

- `ACTIVECAMPAIGN_API_TOKEN` vive solo en backend
- el frontend nunca ve secretos
- CORS + trusted-origin guard para limitar origenes permitidos
- idempotencia para evitar dobles ejecuciones por reintentos
- rate limit y cooldown para reducir abuso

### Comportamiento actual

- `GET /health` es publico
- `POST /contacts/sync-and-subscribe` exige `Origin`/`Referer` permitidos
- `X-Idempotency-Key` es obligatorio y debe ser UUID valido
- payload invalido devuelve `400 validation_error`
- origen no permitido devuelve `403 forbidden_origin`

## Endpoints

### Salud

- `GET /health`

### Contactos

- `POST /contacts/sync-and-subscribe`

Body base:

- `email` (requerido)
- `list_ids` (requerido)
- `tag_ids` (opcional, array de enteros positivos)
- resto de campos opcionales de contacto/utm

### Etiquetas (`tag_ids`)

Comportamiento actual:

- permite aplicar etiquetas cuando el contacto se crea o se actualiza (el endpoint siempre hace `contact/sync`)
- permite aplicar multiples etiquetas en el mismo request
- deduplica `tag_ids` repetidos
- si ActiveCampaign responde duplicado de tag ya aplicado, se trata como exito idempotente
- usa IDs de tag (no nombres)

No incluido en esta API:

- endpoint para consultar si un contacto ya tiene una etiqueta puntual
- resolucion nombre de tag -> id (si se necesita, se resuelve antes en backend usando `/tags`)

## Contrato de respuesta

### Exito

```json
{
  "ok": true,
  "request_id": "req_xxx",
  "action": "synced",
  "contact_id": 123,
  "subscribed_list_ids": [1, 3, 7],
  "meta": {
    "tagged_tag_ids": [10, 20]
  },
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

## Idempotencia
Aplica a:

- `POST /contacts/sync-and-subscribe`

Header obligatorio:

```http
X-Idempotency-Key: <uuid>
```

Reglas:

- sin header: `400 validation_error`
- key invalida: `400 validation_error`
- misma key + mismo metodo/path/body canonico: replay exacto sin reejecutar
- misma key + body distinto: `409 idempotency_conflict`
- request concurrente con misma key en curso: espera hasta `IDEMPOTENCY_WAIT_MS`
- si no finaliza dentro de ese tiempo: `409 idempotency_conflict`

Fingerprint usado:

- `method + path + hash SHA-256 del body canonico`

Persistencia actual:

- store en memoria de proceso (single instance)

## Rate limiting / anti-spam

- rate limit por IP en memoria
- rate limit por email en memoria
- cooldown de 10 segundos por email
- respuestas de limite con `429 rate_limit_error`
- header `Retry-After` cuando corresponde

## Observabilidad / logs
Cada request genera logs estructurados con:

- `request_id`
- `method`
- `path`
- `status`
- `origin`
- `email_hash` (nunca email plano)
- `duration_ms`
- `result`

Eventos de runtime:

- `startup_complete`
- `startup_failed`
- `shutdown_started`
- `shutdown_complete`
- `uncaught_exception`
- `unhandled_rejection`

Salida de logs:

- `stdout`: logs normales
- `stderr`: logs fatales

No se loggea:

- `ACTIVECAMPAIGN_API_TOKEN`
- headers sensibles completos
- body completo sin redaccion

## Codigos HTTP

- `200` exito general
- `204` preflight valido
- `400` body/validacion invalida
- `403` origen no permitido
- `404` ruta no encontrada
- `409` conflicto de idempotencia
- `429` rate limit o cooldown
- `500` error interno
- `502` error upstream de ActiveCampaign

## Error codes frecuentes

- `validation_error`
- `forbidden_origin`
- `idempotency_conflict`
- `rate_limit_error`
- `provider_error`
- `not_found`
- `internal_error`

## Ejemplos rapidos

Smoke test `/health`:

```bash
curl -i -s http://localhost:3000/health
```

Smoke test `/contacts/sync-and-subscribe`:

```bash
curl -i -s -X POST http://localhost:3000/contacts/sync-and-subscribe \
  -H "Content-Type: application/json" \
  -H "Origin: https://midominio.com" \
  -H "Referer: https://midominio.com/landing" \
  -H "X-Idempotency-Key: 1a0c1b7b-5b70-4f8e-9f95-a477f7f2b6da" \
  -d '{
    "email":"user@example.com",
    "first_name":"Juan",
    "list_ids":[1,3,7],
    "tag_ids":[10,20]
  }'
```

Replay idempotente:

- repetir el request anterior con la misma key
- esperado: `200` + header `X-Idempotent-Replay: true`

## Produccion
Deployment checklist corto:

- [ ] `NODE_ENV=production`
- [ ] `LOG_LEVEL=info` o `warn`
- [ ] `ALLOWED_ORIGINS` con dominios exactos
- [ ] token y base URL de ActiveCampaign validados
- [ ] `npm ci && npm run build` ejecutado sin errores
- [ ] servicio levantado con `systemd`
- [ ] smoke tests ejecutados
- [ ] logs visibles en `journalctl`

## Despliegue en VPS con systemd

1. Build:

```bash
npm ci
npm run build
```

2. Crear archivo de entorno:

- `/etc/activecampaign-api.env`

3. Copiar unit file:

- origen: `deploy/activecampaign-api.service`
- destino: `/etc/systemd/system/activecampaign-api.service`

4. Comandos operativos:

```bash
sudo systemctl daemon-reload
sudo systemctl enable activecampaign-api
sudo systemctl restart activecampaign-api
sudo systemctl status activecampaign-api
```

## Ejemplo completo de service file systemd

```ini
[Unit]
Description=ActiveCampaign Contact Sync API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/activecampaign-api
EnvironmentFile=/etc/activecampaign-api.env
ExecStart=/usr/bin/node /opt/activecampaign-api/dist/src/server.js
Restart=on-failure
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

## Como ver logs con journalctl

```bash
journalctl -u activecampaign-api -f
journalctl -u activecampaign-api -n 200 --no-pager
journalctl -u activecampaign-api --since today
journalctl -u <service> -f
```

## Limitaciones actuales

- idempotencia y rate limit en memoria
- no hay persistencia tras reinicio
- no hay coordinacion entre multiples instancias
- si falla la suscripcion a una lista, falla la operacion
- no cubre bulk import ni webhooks

## Notas de mantenimiento

- ejecutar antes de desplegar:

```bash
npm run typecheck
npm test
npm run build
```

- mantener dependencias actualizadas
- revisar contrato oficial de ActiveCampaign si cambian endpoints

Referencias oficiales usadas:

- `POST /contact/sync`: https://developers.activecampaign.com/reference/sync-a-contacts-data
- `POST /contactLists`: https://developers.activecampaign.com/reference/update-list-status-for-contact
- `POST /contactTags`: https://developers.activecampaign.com/reference/create-contact-tag
