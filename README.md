# Saidy Library

Sistema web de biblioteca hibrida para administrar catalogo, copias, prestamos, reservas, multas, inventario, adquisiciones, notificaciones, auditoria y analitica operativa.

Stack principal:

- React + TypeScript en el frontend
- Node + Express + TypeScript como BFF
- Supabase para Auth, Postgres, RLS y migraciones

## Estructura

- `web/`: portal web
- `server/`: API de negocio
- `supabase/migrations/`: esquema y políticas
- `docs/`: analisis, arquitectura y checklist de entrega

## Inicio

1. Instala dependencias:

```bash
npm install
```

2. Configura variables en `.env` en la raíz del repo. Ese archivo alimenta tanto al `server/` como al `web/`.

3. Ejecuta el stack:

```bash
npm run dev
```

## Verificacion

```bash
npm run typecheck
npm run build
```
