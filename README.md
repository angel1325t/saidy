# Saidy Library

Sistema web de biblioteca híbrida con:

- React + TypeScript en el frontend
- Node + Express + TypeScript como BFF
- Supabase para Auth, Postgres, RLS y migraciones

## Estructura

- `web/`: portal web
- `server/`: API de negocio
- `supabase/migrations/`: esquema y políticas

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
