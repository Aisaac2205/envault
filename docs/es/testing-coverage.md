# Pruebas de caja blanca y cobertura — EnVault Management

> 🇬🇧 English version: [../en/testing-coverage.md](../en/testing-coverage.md)

Las pruebas de caja blanca miran dentro del código: los tests se escriben conociendo cómo está construido el programa, y una herramienta de cobertura informa qué sentencias, ramas y funciones ejecutaron en realidad. EnVault la mide en sus suites unitarias (Jest en `apps/api`, Vitest en `apps/web` y `apps/landing`) con un solo comando, `pnpm test:coverage`. Es la contraparte de la suite E2E de caja negra descrita en [e2e-testing.md](e2e-testing.md).

Los resultados de cobertura, junto con el resto de la evidencia de QA, se resumen en el [informe de QA](qa-report.md).

---

## Camino rápido

| # | Comando | Qué hace |
|---|---------|----------|
| 1 | `pnpm install` | Instala el workspace, incluido el plugin de cobertura de Vitest. Una sola vez. |
| 2 | `pnpm test:coverage` | Ejecuta con cobertura las suites unitarias de los tres paquetes (unos 20 s con la caché de Jest caliente, 45 s con la caché fría), imprime un resumen de cuatro líneas por paquete y escribe los informes. |
| 3 | Abrir `apps/api/coverage/index.html` en un navegador | El informe HTML. `apps/web/coverage` y `apps/landing/coverage` contienen los mismos archivos. |

No hacen falta Docker ni base de datos. `pnpm test` no cambia y nunca mide cobertura.

---

## Línea base

Medida el 2026-10-13 con el código y los tests del commit `e1612c4`, en Node.js 24.21.0, pnpm 10.30.0 y Windows 11. Los números son deterministas: una segunda ejecución produjo un `coverage-summary.json` idéntico byte a byte en cada paquete. Cada celda es el porcentaje con cubiertos / total entre paréntesis; los porcentajes se truncan a dos decimales, como los informa Istanbul.

| Paquete | Runner y proveedor | Tests | Sentencias | Ramas | Funciones | Líneas |
|---------|--------------------|-------|-----------:|------:|----------:|-------:|
| `apps/api` | Jest 30.4.2, Istanbul (`babel`) | 55 suites pasadas + 4 omitidas; 365 tests pasados + 32 omitidos | 52.9% (1846 / 3489) | 40.89% (456 / 1115) | 38.04% (226 / 594) | 52.93% (1723 / 3255) |
| `apps/web` | Vitest 4.1.8, V8 | 33 archivos, 171 tests | 26.44% (706 / 2670) | 27.28% (574 / 2104) | 24.05% (223 / 927) | 27.91% (676 / 2422) |
| `apps/landing` | Vitest 4.1.11, V8 | 4 archivos, 42 tests | 10.19% (52 / 510) | 7.88% (19 / 241) | 26.78% (15 / 56) | 10% (49 / 490) |

Cómo leerlo: sus tests unitarios ejecutan cerca de la mitad del código de la API, una cuarta parte de la app web y una décima parte de la landing. Son cifras entre bajas y medias, y las secciones siguientes muestran dónde están los huecos. Antes de comparar filas hay dos salvedades: Istanbul y V8 cuentan distinto (ver [Cómo se calculan los números](#cómo-se-calculan-los-números)), así que conviene comparar un paquete con su propio historial y no con otro paquete; y la cifra de la landing deja fuera sus 22 archivos `.astro` (ver [Excluido de la medición](#excluido-de-la-medición)).

---

## Después de las correcciones de defectos

Medida dos veces, en el mismo Node.js, pnpm y sistema operativo que la línea base: el 2026-10-14 con el código y los tests del commit `23eedc4`, la rama tras las once primeras correcciones de defectos que encontró el trabajo E2E, y el 2026-10-15 con el commit `60fe003`, tras dos correcciones más (D17, una actualización de cronjob que lo sacaba del planificador, y D18, `null` aceptado en campos obligatorios de una actualización parcial). Cada corrección se escribió con el test primero y sumó tests unitarios, así que cada celda se lee línea base → tras once correcciones → tras trece, y el paréntesis es el cambio respecto de la línea base en puntos porcentuales (pp).

| Paquete | Tests (línea base → 11 correcciones → 13 correcciones) | Sentencias | Ramas | Funciones | Líneas |
|---------|--------------------------------------------------------|-----------:|------:|----------:|-------:|
| `apps/api` | 365 → 548 → 585 tests; 55 → 61 → 63 suites | 52.9% → 61.14% → 62.32% (+9.42 pp) | 40.89% → 43.8% → 45.25% (+4.36 pp) | 38.04% → 49.49% → 51.17% (+13.13 pp) | 52.93% → 61.18% → 62.43% (+9.5 pp) |
| `apps/web` | 171 → 202 → 202 tests; 33 → 38 → 38 archivos | 26.44% → 33.29% → 33.29% (+6.85 pp) | 27.28% → 31.79% → 31.79% (+4.51 pp) | 24.05% → 30.77% → 30.77% (+6.72 pp) | 27.91% → 34.91% → 34.91% (+7 pp) |
| `apps/landing` | 42 → 42 → 42 tests; 4 → 4 → 4 archivos | 10.19% → 10.19% → 10.19% (0 pp) | 7.88% → 7.88% → 7.88% (0 pp) | 26.78% → 26.78% → 26.78% (0 pp) | 10% → 10% → 10% (0 pp) |

En `60fe003` las cifras de la API son sentencias 2187 / 3509, ramas 510 / 1127, funciones 305 / 596 y líneas 2044 / 3274.

De dónde viene la mejora: la API ganó specs del controlador de conexiones (no tenía ninguno), del DTO de la solicitud de restore, de la validación de UUID en 20 rutas, de la captura del manifest de PostgreSQL, de los niveles de log y de los DTO de conexión y su actualización parcial; luego, con D17 y D18, dos suites nuevas (el repositorio de cronjobs y el DTO de actualización de cronjob) y más casos en los specs del servicio de cronjobs y del DTO de actualización de conexión. La app web ganó tests de la página de login, de la tabla de rutas (incluida la nueva pantalla de no encontrado), de la página de conexiones y del módulo de API del dashboard; D17 y D18 no la tocaron. La landing no fue tocada por las correcciones, por eso no cambió. Más líneas ejecutadas sigue sin ser prueba de corrección: la línea 535 de `restore.service.ts` se ejecutó 18 veces en la línea base y aun así ocultaba un defecto (ver [Cobertura por área](#cobertura-por-área) y [e2e-testing.md](e2e-testing.md)). Las tablas por área y las listas de archivos menos cubiertos de más abajo se generaron con la línea base y no se volvieron a medir: ejecuta `pnpm test:coverage` para actualizarlas.

---

## Qué es el testing de caja blanca

En las pruebas de caja blanca (también llamadas estructurales o de caja de cristal) quien prueba ve el código fuente y diseña los tests a partir de su estructura: qué sentencias, decisiones y funciones existen, y si cada una se ha ejercitado. La cobertura es la medida: la proporción de esos elementos estructurales que se ejecutaron durante los tests. Responde "¿qué código no alcanzó ningún test?", nunca "¿es correcto el comportamiento?".

| Métrica | Qué cuenta | Técnica que respalda | Nota |
|---------|------------|----------------------|------|
| Sentencia | Sentencias ejecutables que corrieron al menos una vez | Prueba de sentencias | El criterio más débil: `if (x) { a() }` queda cubierto al 100% con un test donde `x` es verdadero, aunque nunca se probó el caso falso. |
| Rama | Cada resultado de cada decisión (`if`, `else`, `?:`, un `case` de `switch`, un operando de `&&`, `\|\|` o `??`) tomado al menos una vez | Prueba de ramas (decisiones) | La métrica más útil aquí: muestra los casos que un test olvidó. |
| Función | Funciones y métodos llamados al menos una vez | Prueba de funciones (métodos) | Muestra el código que ningún test llama. |
| Línea | Líneas físicas del código con al menos una sentencia ejecutable que corrió | Una vista por líneas de la prueba de sentencias | Difiere de las sentencias cuando una línea tiene varias sentencias o una sentencia ocupa varias líneas. |
| Camino | Cada ruta distinta a través de una función según sus decisiones | Prueba de caminos | **No se mide.** El número de caminos crece de forma exponencial con las decisiones y las herramientas no lo informan. Tener todas las ramas cubiertas no implica tener todos los caminos cubiertos. |

Tampoco se miden los criterios a nivel de condición (cobertura de condición/decisión y MC/DC); la cifra de ramas cuenta cada operando de una expresión lógica como una rama, lo que se parece a la cobertura de condiciones pero no es lo mismo.

---

## Qué cubren las suites

| Paquete | Runner | Archivos | Tests | Qué prueban |
|---------|--------|----------|-------|-------------|
| `apps/api` | Jest 30 con ts-jest, entorno Node | 63 ejecutados, 4 omitidos | 585 pasados, 32 omitidos | Servicios, repositorios, controladores, procesadores de colas, estrategias de backup y restore, middleware e interceptores, sanitización, configuración y tres migraciones, siempre con la base de datos, Redis y el almacenamiento de objetos simulados. Los 4 archivos omitidos necesitan una base de datos real (ver [Excluido de la medición](#excluido-de-la-medición)). |
| `apps/web` | Vitest 4 con jsdom y Testing Library | 38 | 202 | Componentes de UI compartidos, hooks y providers, más partes de las pantallas de auditoría, cron jobs, dashboard, dumps y restore, la página de login, la tabla de rutas y la página de conexiones. |
| `apps/landing` | Vitest 4, entorno Node | 4 | 42 | Lógica pura de la sección de documentación: contenido, resaltado de sintaxis, resolución de contenido y fragmentos de enlaces. |

Las cantidades son las del commit `60fe003`; la línea base tenía 55 suites de la API con 365 tests y 33 archivos web con 171 tests (ver [Línea base](#línea-base)).

---

## Cómo ejecutarla

| Alcance | Comando | Salida |
|---------|---------|--------|
| Los tres paquetes | `pnpm test:coverage` (raíz del repositorio) | Las tres ejecuciones en paralelo, cada una con su propio resumen. |
| API | `pnpm --filter @vaultly-control/api test:coverage` | `apps/api/coverage/` |
| App web | `pnpm --filter @vaultly-control/web test:coverage` | `apps/web/coverage/` |
| Landing | `pnpm --filter @vaultly-control/landing test:coverage` | `apps/landing/coverage/` |
| Solo tests, sin cobertura | `pnpm test` | Ninguna carpeta `coverage`. |

Cada paquete escribe el mismo conjunto de archivos en su carpeta `coverage/`, que git ignora:

| Archivo | Contenido |
|---------|-----------|
| `index.html` y una página por archivo fuente | El informe navegable (ver [Lectura del informe HTML](#lectura-del-informe-html)). |
| `lcov.info` | Registros de líneas, funciones y ramas en formato LCOV, para editores y servicios de CI. En Windows las rutas de archivo usan barras invertidas. |
| `coverage-summary.json` | Totales y una entrada por archivo, para scripts. |

Los archivos que ningún test alcanza no se omiten: Jest lista cada archivo `src/**/*.ts` con código ejecutable y Vitest cada archivo bajo `src/**`, así que el código sin probar aparece con 0% en lugar de desaparecer. Para listar los archivos de la API en los que no se ejecutó ninguna línea:

```bash
node -e "const s=require('./apps/api/coverage/coverage-summary.json');for(const[f,v]of Object.entries(s))if(f!=='total'&&v.lines.total>0&&v.lines.covered===0)console.log(f)"
```

Ejecútalo desde la raíz del repositorio después de `pnpm test:coverage`; cambia la carpeta del paquete para los otros dos.

### Cómo se calculan los números

| Paquete | Proveedor | Cómo cuenta |
|---------|-----------|-------------|
| `apps/api` | Istanbul (`coverageProvider: 'babel'`, el valor por defecto de Jest, indicado en la configuración) | Instrumenta el código y cuenta sentencias, ramas y funciones reales. En esta suite es unas 3 veces más rápido que el proveedor `v8` con la caché de Jest fría (41 a 48 s frente a 114 a 135 s) y más de 4 veces más rápido con la caché caliente (14 a 19 s frente a 65 a 89 s), y `v8` informa rangos en lugar de sentencias: 10,326 "sentencias" frente a 3,489 y un 73% de ramas inflado. |
| `apps/web`, `apps/landing` | V8 (`@vitest/coverage-v8`) | Lee la cobertura que V8 registra mientras corren los tests y la convierte en las sentencias, ramas y funciones de Istanbul. `@vitest/coverage-v8` está fijado a la versión exacta de Vitest de cada paquete (4.1.8 y 4.1.11). |

---

## Lectura del informe HTML

Abre `coverage/index.html`. La primera página lista las carpetas con las cuatro métricas; haz clic en una columna para ordenar, en una carpeta para bajar de nivel y en un archivo para ver su código. Los colores siguen los valores por defecto de Istanbul: rojo por debajo de 50%, amarillo de 50% a 80%, verde desde 80%.

| En la página de un archivo | Significado |
|----------------------------|-------------|
| Margen verde con un contador (`7x`) | Cuántas veces corrió esa línea. |
| Margen rosado sin contador | La línea nunca corrió. |
| Fondo rosado sobre el código | Una sentencia que nunca corrió, o una función que nunca se llamó (su nombre aparece resaltado). |
| Insignia oscura `I` o `E` antes de un `if` | Nunca se tomó el camino del `if` (`I`) o el del `else` (`E`). |
| Fondo amarillo sobre un operando de `?:`, `&&`, `\|\|`, `??` o un `case` de `switch` | Ese lado de la expresión nunca se evaluó. |

Un ejemplo resuelto de la línea base: abre `apps/api/coverage/src/modules/restore/restore.service.ts.html` y busca `if (targetEnvironment === Environment.PROD)`. La línea corrió 7 veces y lleva la insignia `I`, de modo que la rama que rechaza una restauración sobre una conexión de producción nunca la tomó ningún test unitario; solo la suite E2E (`rules.pipeline.spec.ts`) lo comprueba. En `lcov.info` el mismo hecho se lee `BRDA:125,4,0,0` (línea 125, bloque 4, rama 0, tomada 0 veces) junto a `BRDA:125,4,1,7` (la otra rama, tomada 7 veces). Un segundo ejemplo: en `apps/web/src/lib/format.ts` la línea 3 elige el idioma con un ternario, y solo corrió el lado `'es-AR'` (62 veces; el lado `'en-US'`, 0).

---

## Archivos menos cubiertos

Ordenados por líneas sin cubrir (líneas que nunca corrieron), los 15 archivos que dejan más código sin ejecutar en cada paquete. "Ramas cubiertas" es la proporción de resultados de decisión tomados.

### API

| # | Archivo | Líneas sin cubrir | Líneas cubiertas | Ramas cubiertas |
|--:|---------|------------------:|-----------------:|----------------:|
| 1 | `src/modules/backup/strategies/mysql-restore.strategy.ts` | 154 | 0% (0/154) | 0% (0/44) |
| 2 | `src/modules/restore/restore.service.ts` | 131 | 56.76% (172/303) | 43.35% (62/143) |
| 3 | `src/modules/maintenance/maintenance.service.ts` | 129 | 54.89% (157/286) | 36.92% (48/130) |
| 4 | `src/modules/cronjobs/cronjobs.service.ts` | 105 | 44.44% (84/189) | 21.42% (18/84) |
| 5 | `src/modules/backup/backup.service.ts` | 82 | 71.32% (204/286) | 58.15% (82/141) |
| 6 | `src/modules/connections/connections.service.ts` | 63 | 12.5% (9/72) | 0% (0/26) |
| 7 | `src/modules/backup/r2.service.ts` | 50 | 42.52% (37/87) | 30.23% (13/43) |
| 8 | `src/modules/jobs/jobs.repository.ts` | 49 | 14.03% (8/57) | 0% (0/44) |
| 9 | `src/modules/backup/backup.repository.ts` | 37 | 47.88% (34/71) | 47.61% (20/42) |
| 10 | `src/modules/connections/connections.controller.ts` | 35 | 0% (0/35) | n/a |
| 11 | `src/modules/cronjobs/cronjobs.controller.ts` | 35 | 0% (0/35) | n/a |
| 12 | `src/modules/backup/backup.module.ts` | 30 | 0% (0/30) | n/a |
| 13 | `src/app.module.ts` | 29 | 0% (0/29) | n/a |
| 14 | `src/connections/seeds/initial-connections.seed.ts` | 29 | 0% (0/29) | 0% (0/18) |
| 15 | `src/auth/seeds/admin.seed.ts` | 26 | 0% (0/26) | 0% (0/14) |

### App web

| # | Archivo | Líneas sin cubrir | Líneas cubiertas | Ramas cubiertas |
|--:|---------|------------------:|-----------------:|----------------:|
| 1 | `src/features/cleanup/hooks/useConnectionRetention.ts` | 107 | 0% (0/107) | 0% (0/57) |
| 2 | `src/features/connections/index.tsx` | 72 | 0% (0/72) | 0% (0/31) |
| 3 | `src/features/connections/components/ConnectionForm.tsx` | 70 | 0% (0/70) | 0% (0/80) |
| 4 | `src/features/restore/hooks/useRestore.ts` | 59 | 0% (0/59) | 0% (0/18) |
| 5 | `src/features/cronjobs/hooks/useCronjobForm.ts` | 54 | 0% (0/54) | 0% (0/28) |
| 6 | `src/features/cronjobs/index.tsx` | 54 | 0% (0/54) | 0% (0/39) |
| 7 | `src/features/users/hooks/useUsers.ts` | 54 | 0% (0/54) | 0% (0/25) |
| 8 | `src/features/dumps/index.tsx` | 53 | 0% (0/53) | 0% (0/48) |
| 9 | `src/lib/format.ts` | 49 | 19.67% (12/61) | 20.33% (12/59) |
| 10 | `src/features/cleanup/hooks/useMaintenance.ts` | 46 | 0% (0/46) | 0% (0/27) |
| 11 | `src/shared/ui/filters.tsx` | 40 | 61.53% (64/104) | 46.29% (25/54) |
| 12 | `src/features/dumps/components/DumpActions.tsx` | 39 | 0% (0/39) | 0% (0/18) |
| 13 | `src/features/cronjobs/lib/cron-validator.ts` | 37 | 0% (0/37) | 0% (0/33) |
| 14 | `src/shared/hooks/useSSE.ts` | 34 | 0% (0/34) | 0% (0/4) |
| 15 | `src/features/cleanup/components/RetentionDialog.tsx` | 33 | 0% (0/33) | 0% (0/62) |

### Landing

Solo 11 de sus 15 archivos con código tienen alguna línea sin cubrir.

| # | Archivo | Líneas sin cubrir | Líneas cubiertas | Ramas cubiertas |
|--:|---------|------------------:|-----------------:|----------------:|
| 1 | `src/components/ui/AsciiGardenCanvas.tsx` | 380 | 0% (0/380) | 0% (0/153) |
| 2 | `src/features/documentation/components/DocumentationSection.tsx` | 19 | 0% (0/19) | 0% (0/49) |
| 3 | `src/components/ui/card.tsx` | 18 | 0% (0/18) | n/a |
| 4 | `src/lib/api-config.ts` | 8 | 0% (0/8) | 0% (0/10) |
| 5 | `src/components/ui/saa-s-template.tsx` | 7 | 0% (0/7) | 0% (0/5) |
| 6 | `src/features/documentation/lib/highlight.ts` | 3 | 90.32% (28/31) | 91.66% (11/12) |
| 7 | `src/features/i18n/get-dictionary.ts` | 2 | 0% (0/2) | 0% (0/3) |
| 8 | `src/features/documentation/lib/resolve-content.ts` | 1 | 94.11% (16/17) | 88.88% (8/9) |
| 9 | `src/features/i18n/dictionaries/en.ts` | 1 | 0% (0/1) | n/a |
| 10 | `src/features/i18n/dictionaries/es.ts` | 1 | 0% (0/1) | n/a |
| 11 | `src/lib/utils.ts` | 1 | 0% (0/1) | n/a |

### Archivos donde no se ejecutó ninguna línea

| Paquete | Archivos con 0% de líneas | Líneas sin cubrir dentro de ellos | Qué son |
|---------|--------------------------:|----------------------------------:|---------|
| `apps/api` | 38 de 120 | 622 de 1,532 (41%) | 12 módulos de Nest (`*.module.ts`, `app.module.ts`), 7 DTOs, 6 controladores, 3 archivos de configuración, 2 seeds, `mysql-restore.strategy.ts`, `audit.service.ts` y 6 archivos pequeños (un filtro de excepciones, un guard, un interceptor, un decorador, una entidad, un enum). |
| `apps/web` | 80 de 145 | 1,388 de 1,746 (80%) | Pantallas completas y lo que cuelga de ellas (componentes, hooks, clientes de API) de conexiones, cron jobs, dumps, usuarios, limpieza, la página de login y la mayor parte del dashboard. |
| `apps/landing` | 9 de 15 | 437 de 441 (99%) | Solo `AsciiGardenCanvas.tsx` tiene 380 líneas; el resto son archivos pequeños de UI e i18n. |

---

## Cobertura por área

### API

Carpeta por carpeta, ordenadas por líneas sin cubrir. Un "archivo" aquí es un archivo con código ejecutable; los archivos que solo tienen tipos no aparecen en el informe de Jest.

| Área | Archivos | Sentencias | Ramas | Funciones | Líneas | Líneas sin cubrir |
|------|---------:|-----------:|------:|----------:|-------:|------------------:|
| `modules/backup` | 15 | 53.38% | 42.73% | 32.02% | 53.49% | 439 |
| `modules/cronjobs` | 8 | 30.57% | 20% | 12% | 30.5% | 205 |
| `modules/restore` | 11 | 62.09% | 47.48% | 48.83% | 62.35% | 198 |
| `modules/maintenance` | 9 | 57.44% | 37.87% | 38.15% | 58.18% | 166 |
| `modules/connections` | 8 | 15.87% | 20% | 9.3% | 14.36% | 149 |
| `modules/jobs` | 11 | 58.6% | 16.94% | 46.66% | 57.67% | 91 |
| `common` | 15 | 67.42% | 63.82% | 73.68% | 67.78% | 67 |
| `auth` | 11 | 40.16% | 57.62% | 50% | 40.9% | 65 |
| `modules/audit` | 5 | 51.76% | 56.25% | 41.66% | 52.7% | 35 |
| `connections` (seeds) | 1 | 0% | 0% | 0% | 0% | 29 |
| `app.module.ts` | 1 | 0% | n/a | 0% | 0% | 29 |
| `database` | 16 | 84.32% | 50% | 45.45% | 84.84% | 25 |
| `config` | 4 | 61.29% | 31.57% | 66.66% | 58.62% | 12 |
| `modules/queue` | 1 | 37.5% | 0% | 0% | 28.57% | 10 |
| `shared` | 2 | 71.87% | 72.72% | 85.71% | 75% | 7 |
| `health` | 2 | 68.18% | 100% | 100% | 72.22% | 5 |

Qué dicen los números, con honestidad:

- **Mejor cubierto, y por ahora está bien.** `common` (68% de las líneas: cifrado, sanitización, pipes y utilidades), `shared` (75%) y `health` (72%) son código pequeño, casi puro y razonablemente probado, y el código de analíticas de series diarias de `modules/jobs` está totalmente cubierto. `database` muestra 85%, pero es sobre todo por archivos de entidades y enums que corren apenas un test los importa, así que dice poco. `modules/jobs` en conjunto está en 58% de líneas y 17% de ramas porque `jobs.repository.ts` (14% de líneas, 0 de 44 ramas) y `jobs.service.ts` (17%) no tienen spec.
- **Riesgoso porque no está cubierto.** El módulo de **conexiones** (14% de las líneas; el servicio 12.5%, el controlador y todos los DTOs 0%) crea, actualiza y elimina las credenciales guardadas de las bases de datos, pero solo su repositorio tiene spec: ahí encontró la suite E2E el D6, la contraseña devuelta por `PATCH /api/connections/:id`. La **estrategia de restore de MySQL** (154 líneas, 0%) es el único motor de restauración sin spec, de modo que una regresión solo aparecería como un fallo E2E lejos de su causa. Los **cron jobs** (30.5%; el servicio 44%, 21% de las ramas) programan los backups automáticos y el watchdog que lanza una alerta cuando uno está vencido. **Maintenance** y `r2.service.ts` (58% y 43% de las líneas) borran dumps y aplican retención, trabajo destructivo con menos de 40% de las ramas tomadas. **Restore** (62%) nunca toma en un test unitario su rama de rechazo de producción (ver [Lectura del informe HTML](#lectura-del-informe-html)) y nunca ejecuta su recuperación al arrancar de los jobs sin terminar. **Auth** (41%) deja `auth.guard.ts`, el guard de sesión que usan los controladores, y `auth.config.ts` en 0%; solo las tablas de autorización E2E los comprueban.
- **Bajo a propósito, o cubierto en otro lugar.** Los archivos `*.module.ts`, `app.module.ts` y los seeds solo conectan dependencias o corren al arrancar; levantar el stack de la suite E2E los ejercita. `http-exception.filter.ts` y `transform.interceptor.ts` (los sobres de error y de éxito) están en 0% en los tests unitarios y los comprueba de caja negra `error-envelope.api.spec.ts`.
- **Ejecutado no es verificado.** La línea 535 de `restore.service.ts` (`getBackupById(dto.sourceBackupId!)`) corrió 18 veces y aun así esconde el D12, porque todos los tests unitarios aportan un origen; la línea está "cubierta" y la entrada que la rompe no. La línea que contiene el D13 (`backup.service.ts:756`, la consulta de la versión de PostgreSQL) corrió 0 veces: los tests unitarios arman los manifiestos con un `serverVersion` fijo, así que el defecto no podía aparecer.

### App web

| Área | Archivos | Sentencias | Ramas | Funciones | Líneas | Líneas sin cubrir |
|------|---------:|-----------:|------:|----------:|-------:|------------------:|
| `features/cleanup` | 11 | 0% | 0% | 0% | 0% | 256 |
| `features/connections` | 8 | 0% | 0% | 0% | 0% | 237 |
| `features/cronjobs` | 9 | 6.09% | 5.46% | 12.94% | 6.4% | 234 |
| `features/restore` | 22 | 33.82% | 32.82% | 24.54% | 34.3% | 203 |
| `features/users` | 11 | 0% | 0% | 0% | 0% | 166 |
| `features/dumps` | 10 | 4.91% | 10.34% | 3.03% | 5.26% | 162 |
| `shared/ui` | 32 | 65.13% | 62.6% | 58.38% | 65.7% | 131 |
| `features/dashboard` | 17 | 12.12% | 10.28% | 11.42% | 13.04% | 100 |
| `features/audit` | 6 | 43.31% | 47.96% | 62.5% | 52% | 60 |
| `shared/hooks` | 5 | 63.75% | 70.68% | 59.37% | 63.82% | 51 |
| `lib` | 1 | 16.66% | 20.33% | 36.36% | 19.67% | 49 |
| `features/auth` | 1 | 0% | 0% | 0% | 0% | 26 |
| `shared/lib` | 5 | 29.26% | 0% | 7.14% | 33.33% | 24 |
| `shared/components` | 10 | 80% | 61.73% | 71.05% | 79.59% | 20 |
| `src` (archivos raíz) | 4 | 32.25% | 80% | 10% | 37.03% | 17 |
| `shared/providers` | 3 | 60% | 50% | 57.14% | 60% | 8 |
| `types` | 1 | 0% | n/a | n/a | 0% | 2 |

Lectura: la biblioteca de componentes compartidos (`shared/ui`, `shared/components`, `shared/hooks`) es donde están los tests de la web, con 64% a 80% de las líneas, y las pantallas de funcionalidades son donde no están. Limpieza (políticas de retención y borrado manual de dumps), usuarios, conexiones y cron jobs no tienen ningún test unitario o casi ninguno (0% a 6%); la suite E2E de UI abre cada sección y recorre los flujos de conexiones, login, dashboard y dumps, así que limpieza, usuarios y cron jobs son las pantallas cuyo comportamiento no comprueba ninguna suite más allá de abrirlas. `src/lib/format.ts` (20% de las líneas, formato de fechas y tiempo relativo con un cambio de idioma) es un lugar barato para agregar tests. La columna Archivos cuenta todos los archivos que listó Vitest, incluidos los que solo tienen tipos.

### Landing

| Área | Archivos | Sentencias | Ramas | Funciones | Líneas | Líneas sin cubrir |
|------|---------:|-----------:|------:|----------:|-------:|------------------:|
| `components/ui` | 3 | 0% | 0% | 0% | 0% | 405 |
| `features/documentation` | 7 | 68.42% | 27.14% | 68.18% | 68.05% | 23 |
| `lib` | 2 | 0% | 0% | 0% | 0% | 9 |
| `features/i18n` | 4 | 0% | 0% | 0% | 0% | 4 |

Lectura: 405 de las 441 líneas sin cubrir son tres componentes de presentación, sobre todo `AsciiGardenCanvas.tsx`, una animación en canvas que los tests unitarios comprueban mal. La lógica probada (`features/documentation`) llega a 68% de las líneas pero solo a 27% de las ramas, así que sus casos límite son lo siguiente que probar. El total de 10% habla solo de los archivos TypeScript; los archivos Astro no se miden.

---

## Excluido de la medición

| Qué | Por qué | Efecto de incluirlo |
|-----|---------|---------------------|
| Archivos de tests y ayudantes de tests (`*.spec.ts`, `*.test.ts(x)`, `src/test/**` en la app web) | Los tests no son el producto. | Ninguno. |
| `apps/api/src/main.ts` (48 líneas) | Punto de entrada del proceso: arranca Nest y escucha en un puerto. | Suma 0 líneas cubiertas. |
| `apps/api/src/data-source.ts` y `apps/api/src/database/migrations/**` (24 migraciones, 268 líneas) | El data source de línea de comandos de TypeORM y las migraciones de esquema generadas; corren contra una base de datos real. Tres tienen spec (`src/database/*.spec.ts`). | Junto con `main.ts`: sentencias de la API 49.21% (1879 / 3818), ramas 39.14% (456 / 1165), funciones 35.63% (232 / 651), líneas 49.11% (1756 / 3575). |
| `apps/api/src/**/index.ts` (2 archivos) | Archivos barril que solo reexportan. | Ninguno. |
| `apps/web/src/main.tsx`, archivos `*.d.ts` | Punto de entrada del navegador y declaraciones de tipos. | Una docena de sentencias. |
| Los 22 archivos `.astro` de la landing (páginas, un layout y componentes) | Vitest no transforma los archivos `.astro`, así que V8 no tiene qué mapear; no se miden y no están en el 10%. | La cobertura real de la landing es menor que la informada. |
| Cuatro specs de integración de la API | Necesitan un PostgreSQL real y se omiten solas sin él: 4 suites omitidas y 32 tests omitidos. Para esta línea base no se levantó ninguna base de datos. | Ver abajo. |

Las cuatro specs de integración y la variable que activa cada una:

| Spec | Variable | Ejercita |
|------|----------|----------|
| `src/auth/audit/auth-audit.integration.spec.ts` | `AUDIT_TEST_DATABASE_URL` | El hook de auditoría y su migración. |
| `src/modules/backup/backup-lease.integration.spec.ts` | `BACKUP_LEASE_TEST_DATABASE_URL` | Los repositorios de leases de backup y de backup. |
| `src/modules/jobs/analytics/jobs-analytics.integration.spec.ts` | `JOBS_ANALYTICS_TEST_DATABASE_URL` | El repositorio de analíticas. |
| `src/modules/restore/restore-lease.integration.spec.ts` | `RESTORE_LEASE_TEST_DATABASE_URL` | Los repositorios de leases de restore y de conexiones. |

Después de la línea base se agregó una quinta spec y creció la de analíticas:

| Spec | Variable | Tests | Ejercita |
|------|----------|------:|----------|
| `src/modules/backup/backup-rollup.integration.spec.ts` | `JOBS_ANALYTICS_TEST_DATABASE_URL` | 20 | Las tres rutas de borrado del repositorio de backup (`deleteByFileKeys`, `deleteByIds`, `deleteFailedOlderThan`) contra la consulta diaria de analíticas: la serie diaria, con y sin filtro de conexión, es idéntica antes y después de una purga completa, de una purga parcial de un día, de dos purgas del mismo día y de dos purgas concurrentes; las filas PENDING y RUNNING se borran sin contarse; los completados sin marcas de tiempo cuentan pero no aportan duración. |
| `src/modules/jobs/analytics/jobs-analytics.integration.spec.ts` | `JOBS_ANALYTICS_TEST_DATABASE_URL` | 17 (antes 13) | Agrega cuatro tests de la combinación de filas vivas y resumen en la consulta diaria. |

La spec nueva reutiliza la variable de analíticas. Con las cuatro variables definidas contra un PostgreSQL 16 local en `localhost:5434`, las cinco suites de integración ejecutaron 60 tests, 0 omitidos (auditoría 4, lease de backup 9, lease de restore 10, analíticas 17, resumen de backup 20), medido el 2026-10-27. Ese mismo día, `pnpm -C apps/api test` sin las variables ejecutó 93 suites y 1561 tests, con 5 suites y 60 tests omitidos. Los tests unitarios del mismo cambio son `src/database/1778716800025-create-backup-daily-rollups.spec.ts` (4 tests) y el bloque de purga de `src/modules/backup/backup.repository.spec.ts` (8 tests).

Como se omiten, los repositorios anteriores están subcontados: su cobertura real es mayor que las cifras de aquí, y una ejecución con las cuatro variables definidas subiría los números de la API. Todo lo de la línea base sale de las 55 suites que corren sin infraestructura.

---

## Cómo agregar un umbral

Hoy nada falla por baja cobertura: esto es medición, no una compuerta. Para que una ejecución falle por debajo de un mínimo, agrégalo a la configuración del paquete. Los valores de abajo son la línea base redondeada hacia abajo, de modo que bloquean regresiones sin exigir todavía más tests.

```ts
// apps/api/jest.config.ts
coverageThreshold: {
  global: { statements: 52, branches: 40, functions: 38, lines: 52 },
},

// apps/web/vitest.config.ts, dentro de `coverage`
thresholds: { statements: 26, branches: 27, functions: 24, lines: 27 },
```

Puedes probar un mínimo sin editar nada. Cada uno de estos comandos termina con código 1 y nombra la métrica que se quedó corta:

```bash
pnpm --filter @vaultly-control/web exec vitest run --coverage --coverage.thresholds.lines=90
pnpm --filter @vaultly-control/api exec jest --coverage '--coverageThreshold={"global":{"lines":90}}'
```

El primero imprime `ERROR: Coverage for lines (27.91%) does not meet global threshold (90%)`, el segundo `Jest: Coverage for lines (52.93%) does not meet "global" threshold (90%)`. El segundo comando está escrito para Git Bash; PowerShell necesita entrecomillar el JSON de otra forma, así que allí usa el archivo de configuración.

---

## Relación con la suite E2E

| | Caja blanca (esta página) | Caja negra ([e2e-testing.md](e2e-testing.md)) |
|---|---------------------------|-----------------------------------------------|
| Ve el código fuente | Sí: los tests se diseñan a partir del código | No: solo HTTP y el navegador |
| Dependencias | Simuladas: base de datos, Redis, almacenamiento de objetos | Reales: PostgreSQL, MySQL, Redis, MinIO, Chromium |
| Necesita Docker | No | Sí (`pnpm docker:e2e`) |
| Comando | `pnpm test`, `pnpm test:coverage` | `pnpm test:e2e`, `pnpm test:e2e:perf` |
| Velocidad | Unos 20 s para los tres paquetes | Unos 25 s la suite funcional, más el arranque del stack |
| Mide | Sentencias, ramas, funciones, líneas | Comportamientos comprobados; no informa cobertura de código |
| Fuerte en | Lógica y casos límite dentro de una unidad | Integración, contratos, seguridad y defectos que solo aparecen con piezas reales |

Las dos son complementarias, y la línea base lo muestra. La cobertura de caja blanca dice dónde faltan tests unitarios (restore de MySQL, el módulo de conexiones, el guard de auth); la suite E2E muestra que esos caminos funcionan hoy de punta a punta, y encontró defectos que la cobertura no podía (el D6 en un módulo cuyo servicio y controlador no tienen spec, el D13 en una línea que ningún test unitario ejecutó, el D12 en una línea que sí ejecutaron). Ninguna reemplaza a la otra. Cuando se corrija un defecto de [Defectos conocidos](e2e-testing.md#defectos-conocidos), agrega primero su test unitario y vuelve a medir; actualiza la tabla de la línea base cuando un cambio mueva los números de forma apreciable.
