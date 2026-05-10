# Fase 9 - Checklist de entrega

## 1) Arranque tecnico

Instalar dependencias y ejecutar el portal:

```bash
npm install
npm run dev
```

Verificar calidad tecnica:

```bash
npm run typecheck
npm run build
```

## 2) Flujo funcional minimo

- Login y registro funcionan con Supabase Auth.
- Administracion RBAC permite crear usuarios, roles, permisos y asignaciones.
- Catalogo permite buscar, crear, editar, archivar materiales y administrar copias.
- Circulacion permite crear prestamos, renovar, devolver, reservar, cancelar reservas y gestionar multas.
- Administracion permite registrar inventario, adquisiciones, prestamos interbibliotecarios y notificaciones.
- Digital permite listar recursos y abrir acceso cuando el perfil lo permite.
- Auditoria registra acciones sensibles.

## 3) Validacion por rol

- `ADMIN`: acceso total a usuarios, roles, catalogo, circulacion, reportes, auditoria y operacion.
- `BIBLIOTECARIO`: gestiona catalogo, copias, prestamos, reservas, multas, inventario y reportes operativos.
- `DOCENTE` / `INVESTIGADOR` / `ESTUDIANTE`: consulta catalogo, reserva, renueva prestamos propios, devuelve prestamos propios y consulta multas propias.

## 4) Demo sugerida

1. Crear usuario bibliotecario o admin.
2. Crear material con autores, etiquetas, ISBN/ISSN/DOI y Dewey.
3. Agregar copia disponible con ubicacion.
4. Crear prestamo fisico para un usuario.
5. Renovar y devolver el prestamo.
6. Crear reserva y cancelarla.
7. Registrar inventario, adquisicion, solicitud interbibliotecaria y notificacion.
8. Revisar auditoria y analitica operativa.

## 5) Git y release

- Trabajar desde `feature/library-crud-circulation`.
- Mantener commits pequenos y logicos con conventional commits.
- Antes de mergear, confirmar `git status` limpio y verificaciones pasando.
