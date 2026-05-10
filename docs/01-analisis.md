# Fase 1 - Analisis del sistema

## Problema

Las bibliotecas hibridas necesitan administrar materiales fisicos y digitales desde un solo portal: catalogo, copias, prestamos, reservas, multas, inventario, adquisiciones, notificaciones, auditoria y analitica.

## Usuarios

- Administrador: configura usuarios, roles, permisos, auditoria y modulos globales.
- Bibliotecario: gestiona catalogo, copias, prestamos, devoluciones, inventario, multas y reportes.
- Docente o investigador: consulta catalogo, accede a recursos digitales, reserva y renueva materiales con reglas ampliadas.
- Estudiante: busca materiales, reserva, consulta prestamos propios, renueva y revisa multas.
- Visitante/publico: acceso limitado segun permisos configurados.

## Funcionalidades

- Registro y autenticacion con Supabase Auth.
- RBAC granular con roles y permisos.
- Catalogo avanzado de libros, ebooks, revistas, articulos, tesis, audiolibros, multimedia y documentos institucionales.
- Identificadores bibliograficos: ISBN, ISSN, DOI, signatura, Dewey y MARC simplificado.
- Gestion de copias, ubicaciones, estados fisicos e inventario.
- Prestamos fisicos y digitales, renovaciones, devoluciones, reservas y multas.
- Biblioteca digital con acceso controlado por permisos.
- Adquisiciones, solicitudes interbibliotecarias, notificaciones internas, auditoria y analitica operativa.

## Alcance actual

- Aplicacion web responsive en React + TypeScript.
- API de negocio en Node + Express + TypeScript.
- Supabase para Auth, Postgres, RLS, migraciones y servicio administrativo.
- Integraciones externas como pagos, SMS, RFID, biometria e IA quedan fuera de esta etapa; se registran datos y estados internos preparados para evolucionar.
