# ¿Qué corte me queda?

App web (PWA) **solo para teléfono** que mide las proporciones reales del
rostro en una foto y recomienda qué cortes de pelo favorecen y cuáles evitar.
También lee el tono de piel, el color de pelo y de ojos, y avisa cuando la luz
no alcanza para dar un resultado confiable.

**El análisis corre entero en el dispositivo.** No hay servidor, no hay cuenta,
no se sube ninguna foto y funciona sin conexión una vez instalada. La única
excepción es la prueba virtual del corte (opcional), que sí manda la foto a un
modelo de IA — la app lo avisa antes de hacerlo.

---

## Arrancar

```bash
npm install
npm run dev      # https://localhost:5173
```

El servidor levanta con HTTPS y certificado autofirmado a propósito: los
navegadores **solo dan acceso a la cámara sobre HTTPS o en `localhost`**. Hay
que aceptar el aviso de certificado no confiable.

En una computadora la app **no se abre**: muestra el aviso de "abrila desde el
celular" y oculta la interfaz. Para verla en el navegador de escritorio hay que
activar la emulación de dispositivo móvil en las DevTools (Ctrl+Shift+M).

### Probarlo en el celular

```bash
npm run dev -- --host
```

Vite imprime una URL con la IP de la red local (`https://192.168.x.x:5173`).
Se abre esa URL en el teléfono y se acepta el aviso del certificado.

---

## Desplegar en Vercel

El repo ya trae [`vercel.json`](vercel.json) y la función serverless
[`api/tryon.js`](api/tryon.js). El flujo es:

```bash
npm i -g vercel
vercel            # primer despliegue, de prueba
vercel --prod
```

Después, **una sola variable de entorno** en el panel de Vercel
(*Settings → Environment Variables*):

| Variable | Valor | Para qué |
| --- | --- | --- |
| `GEMINI_API_KEY` | tu clave de [Google AI Studio](https://aistudio.google.com/apikey) | Que la prueba virtual funcione sin que el usuario final configure nada |

Sin esa variable la app funciona igual: el análisis de rostro, los colores y
las recomendaciones no dependen de ninguna API. Lo único que queda inactivo es
el botón "probarlo en mi foto", que en ese caso ofrece pegar una clave propia
que se guarda solo en el teléfono.

> **Tené en cuenta:** con la clave en el servidor, cualquiera que tenga la URL
> consume tu cuota. Para uso familiar no es problema; si la dirección se hace
> pública, conviene sacar la variable o poner la app detrás de Vercel
> Authentication.

`dist/` pesa ~38 MB, casi todo el modelo de detección facial. Está dentro de
los límites de hosting estático de Vercel y se cachea con `immutable`, así que
se descarga una sola vez.

### ¿Hace falta Supabase?

**No.** La app no guarda nada: analiza la foto en memoria y muestra el
resultado. No hay usuarios, ni sesiones, ni historial. Agregar Supabase
significaría mandar fotos a un servidor, que es justamente lo que la app
promete no hacer.

Solo tendría sentido si en el futuro se quisiera guardar el historial de
análisis entre dispositivos o tener cuentas. Hoy sería complejidad y una
filtración de privacidad a cambio de nada.

---

## Cómo funciona

### 1. Detección
[MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
corre por WebAssembly dentro del navegador y devuelve 478 puntos 3D del rostro,
incluidos los del iris. El modelo está incluido en el repo: no se descarga nada
de terceros en tiempo de ejecución.

### 2. Calidad de imagen ([`faceAttributes.js`](src/faceAttributes.js))
Antes de dar un resultado se mide la luz **sobre la zona de la cara**, no sobre
la foto entera. Se detectan tres problemas distintos y se avisa de cada uno:

- **poca luz** (luminancia media baja o muchos píxeles negros),
- **zonas quemadas** (flash directo o contraluz),
- **luz de un solo lado** (comparando las dos mitades del rostro).

Con poca luz el detector pierde precisión y la lectura de color se vuelve
directamente inventada — en penumbra todo tiende al gris y cualquier pelo
castaño se lee negro. Por eso se avisa en vez de dar un resultado malo.

### 3. Medición ([`faceGeometry.js`](src/faceGeometry.js))
Largo del rostro, ancho de pómulos, de mandíbula, de frente, ángulo del mentón
y rasgos dimórficos (separación ceja–ojo, grosor del labio, ancho de nariz).
Antes de medir se corrige la inclinación de la cabeza rotando los puntos hasta
que la línea de los ojos queda horizontal. Los 10 puntos del contorno están
verificados contra `FaceLandmarker.FACE_LANDMARKS_FACE_OVAL`.

### 4. Forma del rostro ([`faceShape.js`](src/faceShape.js))
Las proporciones se convierten a *z-scores* contra una distribución medida
sobre retratos frontales reales y se comparan con **ocho** prototipos: ovalado,
redondo, cuadrado, alargado, rectangular, corazón, diamante y triangular.
Devuelve ganador, segundo lugar y confianza: muchas caras están genuinamente
entre dos formas y la app lo dice en vez de fingir certeza.

### 5. Color ([`faceAttributes.js`](src/faceAttributes.js))
Todo se mide en píxeles reales, en zonas ancladas a los landmarks:

- **Piel** — parches de mejillas y frente, mediana intercuartil (se descartan
  sombras y brillos por igual). Se clasifica con el ángulo **ITA°**, que es la
  medida estándar en dermatología, no una escala inventada.
- **Pelo** — varios parches sobre el nacimiento del pelo, pegados a la línea
  media, con mediana de medianas. Si la zona sale igual a la piel, se reporta
  "rapado" en lugar de inventar un color.
- **Ojos** — píxeles dentro del círculo del iris, descartando pupila y
  reflejos. Si el iris mide menos de ~5 px de radio se responde "no se pudo
  ver", porque a esa resolución no queda color que leer.

### 6. Género ([`gender.js`](src/gender.js))
Se estima a partir de rasgos con dimorfismo sexual documentado, **solo para
preseleccionar** qué set de recomendaciones mostrar. La app nunca afirma el
género de nadie: muestra "Recomendaciones para" con el botón ya elegido y se
cambia con un toque. Cuando la estimación es floja, el texto invita
explícitamente a corregirla.

**Precisión medida: 66,5%** (exactitud balanceada, validación cruzada dejando
uno afuera, sobre 71 retratos etiquetados desde Wikidata). Es claramente mejor
que tirar una moneda y claramente peor que un dato: alrededor de **1 de cada 3
personas recibe la preselección equivocada**. Por eso la interfaz siempre
invita a corregirla y nunca la presenta como resuelta.

Sobre el mismo set, ajustando y midiendo con los mismos datos daba 79,8% — la
diferencia con el 66,5% es puro sobreajuste, y es la razón por la que el script
reporta el número validado.

Un hallazgo que salió de medir en vez de suponer: la intuición de "mandíbula
ancha y mentón cuadrado = hombre" **no se sostiene** con estos landmarks; la
separación medida iba en la dirección contraria. Toda la señal útil está en el
grosor del labio y la separación ceja–ojo. La primera versión, con pesos
elegidos a mano según esa intuición, clasificaba a un hombre como mujer con 72%
de "confianza".

---

## Verificación

Con el servidor de desarrollo levantado en otra terminal:

```bash
npm test                                    # flujo completo + bloqueo en escritorio
npm run test:api                            # función serverless (no necesita clave)
node scripts/tilt-test.mjs                  # cabeza inclinada
node scripts/attrs-eval.mjs                 # distribución de piel, pelo y ojos
node scripts/calibrate.mjs                  # estadísticas y barrido de temperatura
node scripts/gender-eval.mjs                # precisión del estimador de género

npm run build && npm run preview            # y luego:
ORIGIN=https://localhost:4173 node scripts/offline-test.mjs
```

Las pruebas manejan Chrome de verdad con el detector de verdad — no hay mocks.
Emulan un teléfono (`hasTouch`/`isMobile`), porque si no la app se bloquea sola.

Estos scripts encontraron errores reales que no se ven leyendo el código:

| Qué se rompía | Cómo se detectó |
| --- | --- |
| Todas las caras se clasificaban "redondo" | Los umbrales venían de la literatura de peluquería; los landmarks de MediaPipe no miden lo mismo que una cinta métrica |
| Las líneas de medición se iban de la cara | Se usaban los puntos **rotados** (los de medir) también para **dibujar** |
| Una cabeza ladeada se reportaba "cara girada" | La matriz de pose de MediaPipe es **row-major**, no column-major |
| El 18% de las caras salía "pelirroja" | Los parches de pelo caían fuera de la silueta y muestreaban el fondo (una bandera roja) |
| Toda la muestra salía un tono más pálida | La primera categoría de piel era inalcanzable y el recorte de percentiles era asimétrico |
| El 43% de los ojos salía "gris" | A esa resolución el iris se dessatura; el umbral de croma estaba demasiado flojo |
| El vidrio se veía gris plano | El `::before` con `z-index:-1` quedaba detrás del fondo opaco del `body` |
| El estimador de género daba vuelta a las personas | Los pesos elegidos a mano tenían el signo cambiado en mandíbula y mentón |

---

## Calibración

`NORM` en [`src/faceShape.js`](src/faceShape.js) sale de medir 50 retratos
frontales de dominio público (Congreso de EE.UU. y NASA) con estos mismos
landmarks. La temperatura de la softmax (`T = 0.45`) se eligió barriendo
valores: deja la confianza del ganador en una mediana del ~51% y marca como
"mixto" a ~1 de cada 5 rostros. Con el valor inicial la mediana daba 27% —
apenas por encima del azar de 1/8 — y 4 de cada 5 caras salían mixtas.

Para regenerar:

```bash
node scripts/fetch-calibration-set.mjs   # muestra a public/_test/
node scripts/fetch-gender-set.mjs        # muestra etiquetada a public/_gender/
npm run dev                              # en otra terminal
node scripts/calibrate.mjs               # imprime el bloque NORM a pegar
node scripts/gender-eval.mjs             # imprime los pesos de género a pegar
```

`tools/calibrar.html` es una página de desarrollo para soltar fotos propias y
ver las proporciones y colores medidos.

**Sesgo conocido de la muestra:** son mayormente adultos, con predominio
masculino. Sirve como línea de base de cara adulta; una muestra más equilibrada
mejoraría la calibración. Reemplazar las fotos de `public/_test/` y volver a
correr `calibrate.mjs` es todo lo que hace falta.

---

## Estructura

```
index.html              interfaz (una sola página, cuatro pantallas)
vercel.json             despliegue y cabeceras de caché
api/tryon.js            función serverless: prueba virtual con la key del servidor
src/
  main.js               orquestación, cámara, canvas, bloqueo en escritorio
  faceGeometry.js       landmarks → medidas en píxeles → proporciones
  faceShape.js          proporciones → forma de rostro + confianza (NORM)
  faceAttributes.js     calidad de luz, piel (ITA°), pelo, ojos
  gender.js             estimación de género para preseleccionar recomendaciones
  haircuts.js           base de recomendaciones por forma y género
  tryon.js              prueba virtual (servidor, con respaldo de clave propia)
  styles.css            glassmorphism
  fonts.css             generado por scripts/fetch-fonts.mjs
public/
  models/ wasm/         detector facial y su runtime
  fonts/                Poppins auto-alojada (funciona sin conexión)
  sw.js                 service worker
scripts/                íconos, muestras, calibración y pruebas
  sync-wasm.mjs         recopia el runtime de MediaPipe (correr al actualizarlo)
tools/calibrar.html     herramienta de desarrollo
```

## Límites conocidos

- Es una **guía basada en proporciones, no una regla**. La forma del rostro es
  un continuo, no ocho cajones.
- Necesita una foto **frontal y con buena luz**. La app avisa cuando no lo es,
  pero no puede corregirlo.
- El color de ojos es el dato menos confiable: a la resolución a la que se
  analiza, el iris ocupa pocos píxeles. Cuando es demasiado chico se dice "no
  se pudo ver" en lugar de adivinar.
- La estimación de género es **estadística y falible**; por eso siempre es
  corregible con un toque.
- La prueba virtual depende del filtro de contenido del proveedor, que a veces
  rechaza fotos de personas reales.
