/**
 * Recomendaciones de corte por forma de rostro.
 *
 * El criterio detrás de todo esto es uno solo y es el que usa cualquier
 * peluquero: el pelo se usa para acercar la cara al óvalo. Si la cara es
 * ancha, se le suma altura y se le resta volumen a los costados. Si es larga,
 * al revés. Si es angulosa, se suavizan las líneas. Si un rasgo domina
 * (frente, mandíbula), se compensa el opuesto.
 *
 * `tryon` es la descripción en inglés que se le manda al modelo de imagen.
 */

const D = {
  ovalado: {
    hombre: {
      recommended: [
        {
          name: 'Corte texturizado hacia adelante (French crop)',
          desc: 'Corto a los costados, largo medio arriba peinado hacia adelante con textura.',
          why: 'El óvalo ya está equilibrado, así que no hay nada que corregir: este corte lo aprovecha y es de los más fáciles de mantener.',
          tryon: 'a modern French crop haircut: short faded sides, textured medium-length top swept forward with a blunt fringe',
        },
        {
          name: 'Fade medio con volumen arriba',
          desc: 'Degradado desde la mitad de la cabeza, con 5–8 cm arriba peinado con movimiento.',
          why: 'Marca los pómulos sin alargar la cara. La transición limpia le da forma sin necesidad de mucho producto.',
          tryon: 'a mid fade haircut with 6cm of textured volume on top, styled with natural movement',
        },
        {
          name: 'Quiff clásico',
          desc: 'Volumen levantado al frente, costados prolijos y cortos.',
          why: 'Suma un poco de altura sin exagerar. Al óvalo le entra bien porque tolera altura extra sin verse alargado.',
          tryon: 'a classic quiff hairstyle with volume lifted at the front and short tapered sides',
        },
        {
          name: 'Media melena con capas',
          desc: 'Pelo hasta la oreja o un poco más, con capas suaves.',
          why: 'Si querés largo, el óvalo es la forma que mejor lo banca: no se le agranda ni se le alarga nada.',
          tryon: 'a medium-length layered hairstyle reaching the ears, natural texture, no undercut',
        },
      ],
      avoid: [
        'Flequillo recto y pesado tapando toda la frente: acorta el óvalo y lo empuja hacia el redondo.',
        'Volumen exagerado arriba (pompadour muy alto): estira la cara de más.',
      ],
      beard: ['Barba corta y prolija de 3–10 mm', 'Candado (goatee)', 'Barba de 3 días'],
    },
    mujer: {
      recommended: [
        {
          name: 'Long bob (lob) a la altura de la clavícula',
          desc: 'Corte recto o con capas mínimas que cae justo en la clavícula.',
          why: 'Es el corte más versátil que existe y el óvalo lo sostiene sin que haya que corregir nada.',
          tryon: 'a collarbone-length long bob (lob) haircut with a blunt, clean line',
        },
        {
          name: 'Capas largas en cascada',
          desc: 'Largo por debajo de los hombros con capas que arrancan a la altura del mentón.',
          why: 'Las capas dan movimiento y enmarcan los pómulos sin desbalancear las proporciones.',
          tryon: 'long layered hair falling below the shoulders, face-framing layers starting at the chin',
        },
        {
          name: 'Pixie con textura',
          desc: 'Muy corto, con volumen arriba y nuca despejada.',
          why: 'El pixie deja la cara completamente al descubierto, y el óvalo es la forma que mejor resiste esa exposición.',
          tryon: 'a textured pixie cut, short at the nape with volume on top',
        },
        {
          name: 'Flequillo cortina',
          desc: 'Flequillo abierto al medio que se funde con el largo a los costados.',
          why: 'Suma interés sin cerrar la cara. Funciona con casi cualquier largo.',
          tryon: 'long hair with curtain bangs parted in the middle, blending into the length',
        },
      ],
      avoid: [
        'Volumen muy apretado y redondo en la coronilla: rompe el equilibrio natural del óvalo.',
        'Flequillo recto muy corto y pesado: acorta la cara innecesariamente.',
      ],
    },
  },

  redondo: {
    hombre: {
      recommended: [
        {
          name: 'Pompadour o quiff alto',
          desc: 'Mucho volumen arriba peinado hacia atrás y arriba, costados bien cortos.',
          why: 'Es la corrección exacta que necesita el rostro redondo: suma altura y quita ancho. Alarga la cara al instante.',
          tryon: 'a tall pompadour hairstyle with high volume swept up and back, very short faded sides',
        },
        {
          name: 'High fade con largo arriba',
          desc: 'Degradado que arranca alto en la cabeza, dejando buen largo en la parte superior.',
          why: 'El fade alto corta el ancho a la altura de los pómulos, que es justo donde el rostro redondo mide de más.',
          tryon: 'a high fade haircut with skin fade at the temples and long textured hair on top',
        },
        {
          name: 'Undercut con peinado hacia atrás',
          desc: 'Costados rapados, contraste fuerte con la parte de arriba.',
          why: 'El contraste marcado crea líneas verticales, que es lo que le falta a un rostro redondo.',
          tryon: 'a disconnected undercut with shaved sides and long slicked-back hair on top',
        },
        {
          name: 'Corte lateral con raya marcada',
          desc: 'Raya definida al costado, volumen asimétrico.',
          why: 'La asimetría rompe la simetría circular del rostro y lo hace ver más angular.',
          tryon: 'a side part haircut with a defined hard part line and asymmetric volume',
        },
      ],
      avoid: [
        'Bowl cut o cualquier corte redondeado: duplica la forma de la cara en vez de compensarla.',
        'Pelo corto parejo por todos lados (buzz cut): deja el ancho totalmente expuesto.',
        'Volumen a los costados o rulos sueltos a la altura de las orejas: ensancha todavía más.',
      ],
      beard: [
        'Barba más larga en el mentón que en los costados: alarga la cara',
        'Perilla o candado: crea un punto vertical abajo',
        'Evitar barba redonda y tupida en las mejillas',
      ],
    },
    mujer: {
      recommended: [
        {
          name: 'Largo por debajo de los hombros con capas',
          desc: 'Pelo largo, liso o con ondas suaves, capas que arrancan por debajo del mentón.',
          why: 'La línea vertical del largo estiliza. Las capas por debajo del mentón evitan sumar ancho donde no conviene.',
          tryon: 'long hair below the shoulders with soft layers starting below the chin, sleek and straight',
        },
        {
          name: 'Lob angulado (más largo adelante)',
          desc: 'Bob largo cortado en diagonal, más corto atrás y más largo hacia la cara.',
          why: 'La diagonal genera líneas que afinan las mejillas en vez de rodearlas.',
          tryon: 'an angled long bob, shorter at the back and longer at the front, with a diagonal cutting line',
        },
        {
          name: 'Volumen en la coronilla',
          desc: 'Cualquier largo, pero con raíz levantada y volumen concentrado arriba.',
          why: 'Sumar altura arriba cambia la proporción largo/ancho, que es el problema de fondo del rostro redondo.',
          tryon: 'hairstyle with lifted roots and concentrated volume at the crown, flat at the sides',
        },
        {
          name: 'Flequillo lateral largo y desfilado',
          desc: 'Flequillo que cruza en diagonal y se funde con el largo.',
          why: 'La diagonal corta la redondez de la frente sin cerrar la cara.',
          tryon: 'long side-swept bangs crossing the forehead diagonally, blending into the length',
        },
      ],
      avoid: [
        'Bob corto a la altura del mentón: termina justo en la parte más ancha y la remarca.',
        'Flequillo recto y tupido: achata la cara y acentúa el círculo.',
        'Rulos con mucho volumen a los costados de la cabeza.',
        'Raya al medio con pelo pegado a la cabeza: no aporta ninguna altura.',
      ],
    },
  },

  cuadrado: {
    hombre: {
      recommended: [
        {
          name: 'Crop texturizado con flequillo desfilado',
          desc: 'Costados cortos, arriba texturizado, flequillo irregular hacia adelante.',
          why: 'La textura irregular suaviza el ángulo recto de la frente sin esconder la mandíbula, que es tu mejor rasgo.',
          tryon: 'a textured crop haircut with a choppy, uneven fringe falling forward and short sides',
        },
        {
          name: 'Buzz cut o corte militar',
          desc: 'Muy corto y parejo en toda la cabeza.',
          why: 'Pocos rostros lo sostienen. El cuadrado sí: la estructura ósea marcada es lo que hace que este corte funcione.',
          tryon: 'a buzz cut, very short uniform hair all over the head',
        },
        {
          name: 'Peinado hacia atrás con largo medio',
          desc: 'Pelo peinado hacia atrás con volumen natural, sin rigidez.',
          why: 'Deja la mandíbula a la vista y las líneas hacia atrás acompañan la estructura angular.',
          tryon: 'medium-length hair slicked back with natural volume and movement',
        },
        {
          name: 'Capas suaves de largo medio',
          desc: 'Largo hasta la mitad de la oreja con capas redondeadas.',
          why: 'Si querés bajarle intensidad a la mandíbula, las capas curvas son lo que compensa los ángulos rectos.',
          tryon: 'medium-length hair with soft rounded layers reaching mid-ear',
        },
      ],
      avoid: [
        'Corte de línea recta y perfecta arriba: suma un ángulo más a una cara que ya tiene varios.',
        'Costados con volumen cuadrado: ensancha la mandíbula todavía más.',
      ],
      beard: [
        'Barba corta y prolija siguiendo la línea de la mandíbula',
        'Barba redondeada en el mentón: suaviza el ángulo',
        'Evitar barba con líneas rectas y marcadas en la mejilla',
      ],
    },
    mujer: {
      recommended: [
        {
          name: 'Ondas suaves de largo medio',
          desc: 'Largo entre el mentón y los hombros, con ondas marcadas.',
          why: 'Las curvas de la onda son la contracara exacta de los ángulos rectos de la mandíbula.',
          tryon: 'medium-length hair with soft defined waves falling between chin and shoulders',
        },
        {
          name: 'Capas que enmarcan la cara',
          desc: 'Largo con capas que arrancan a la altura del pómulo y caen sobre la mandíbula.',
          why: 'El pelo que cae por delante de la mandíbula rompe la línea horizontal y la afina visualmente.',
          tryon: 'long hair with face-framing layers starting at the cheekbones and falling over the jawline',
        },
        {
          name: 'Flequillo cortina',
          desc: 'Abierto al medio, cayendo en diagonal hacia los costados.',
          why: 'Las diagonales suavizan la frente ancha y llevan la atención a los ojos.',
          tryon: 'curtain bangs parted in the middle falling diagonally to the sides',
        },
        {
          name: 'Pixie desordenado con volumen arriba',
          desc: 'Corto y texturizado, con la nuca despejada y movimiento en la coronilla.',
          why: 'El volumen arriba alarga y la textura desordenada quita rigidez a los ángulos.',
          tryon: 'a messy textured pixie cut with volume at the crown and a soft outline',
        },
      ],
      avoid: [
        'Bob recto exactamente a la altura de la mandíbula: la subraya al máximo.',
        'Flequillo recto y tupido: suma una línea horizontal más.',
        'Pelo tirante todo hacia atrás: deja la mandíbula sin ningún contrapeso.',
      ],
    },
  },

  alargado: {
    hombre: {
      recommended: [
        {
          name: 'Flequillo hacia adelante (crop con fringe)',
          desc: 'Pelo peinado hacia adelante, cubriendo parte de la frente.',
          why: 'Acortar la frente es la forma más directa y efectiva de reducir el largo visual de la cara.',
          tryon: 'a crop haircut with a straight fringe combed forward covering part of the forehead',
        },
        {
          name: 'Corte de largo medio con volumen a los costados',
          desc: 'Nada de rapado: se deja peso a los costados, a la altura de las orejas.',
          why: 'El rostro alargado necesita ancho. Los costados con cuerpo son exactamente eso.',
          tryon: 'a medium-length haircut with body and volume kept at the sides around ear level, no fade',
        },
        {
          name: 'Rulos o textura natural sin rapar',
          desc: 'Dejar el rizo o la onda natural, mantenido a lo ancho.',
          why: 'El volumen lateral del rizo compensa el largo sin que tengas que hacer nada.',
          tryon: 'natural curly hair kept at medium length with lateral volume, no shaved sides',
        },
        {
          name: 'Raya al costado con caída lateral',
          desc: 'Raya definida y el pelo cayendo hacia un lado, no hacia arriba.',
          why: 'La línea horizontal de la raya corta la verticalidad de la cara.',
          tryon: 'a side part with hair falling flat to one side, horizontal emphasis',
        },
      ],
      avoid: [
        'Pompadour, quiff o cualquier volumen alto: alarga todavía más una cara que ya es larga.',
        'Undercut o fade muy alto: quita el ancho justo donde más falta hace.',
        'Peinado tirante hacia atrás dejando toda la frente al aire.',
      ],
      beard: [
        'Barba corta y pareja a los costados: suma ancho',
        'Evitar perilla o barba larga en el mentón, alarga la cara',
        'Patillas más marcadas ayudan a ensanchar',
      ],
    },
    mujer: {
      recommended: [
        {
          name: 'Bob o lob con ondas',
          desc: 'Largo entre el mentón y los hombros, con onda que da cuerpo.',
          why: 'Corta el largo vertical y suma ancho justo donde la cara lo necesita.',
          tryon: 'a wavy bob ending between the chin and shoulders with lateral volume',
        },
        {
          name: 'Flequillo recto',
          desc: 'Flequillo tupido a la altura de las cejas.',
          why: 'De todas las formas de rostro, la alargada es la que más se beneficia del flequillo recto: acorta la cara de golpe.',
          tryon: 'a full blunt fringe cut straight at eyebrow level',
        },
        {
          name: 'Capas con volumen a los costados',
          desc: 'Capas que suman cuerpo a la altura de las orejas y los pómulos.',
          why: 'Todo el volumen lateral que sumes juega a favor.',
          tryon: 'layered hair with volume concentrated at the sides around cheekbone and ear level',
        },
        {
          name: 'Ondas al agua o rulos definidos',
          desc: 'Textura marcada que ensancha la silueta.',
          why: 'El rizo ocupa espacio horizontal, que es exactamente lo que compensa el rostro alargado.',
          tryon: 'defined curly hair with wide horizontal silhouette, shoulder length',
        },
      ],
      avoid: [
        'Pelo muy largo y liso pegado a la cabeza: estira todavía más.',
        'Raya al medio sin volumen: refuerza la línea vertical.',
        'Volumen alto en la coronilla.',
      ],
    },
  },

  rectangular: {
    hombre: {
      recommended: [
        {
          name: 'Flequillo texturizado hacia adelante',
          desc: 'Pelo hacia adelante cubriendo parte de la frente, con puntas irregulares.',
          why: 'Acorta la cara y las puntas irregulares suavizan la línea recta de la mandíbula. Ataca los dos problemas de una.',
          tryon: 'a textured crop with a choppy fringe combed forward covering part of the forehead, medium sides',
        },
        {
          name: 'Largo medio con volumen a los costados',
          desc: 'Sin rapar: se deja cuerpo a la altura de las orejas, con ondas suaves.',
          why: 'El ancho lateral compensa el largo, y la curva de la onda contrarresta los ángulos rectos.',
          tryon: 'a medium-length haircut with soft waves and volume at the sides around ear level, no fade',
        },
        {
          name: 'Capas redondeadas de largo medio',
          desc: 'Largo hasta media oreja, con capas curvas y nada de líneas rectas.',
          why: 'Todo lo que sea curvo juega en contra de la rigidez de una cara rectangular.',
          tryon: 'medium-length hair with soft rounded layers reaching mid-ear, no sharp lines',
        },
      ],
      avoid: [
        'Pompadour o cualquier volumen alto: alarga todavía más una cara que ya es larga.',
        'Undercut o fade alto: quita ancho justo donde más falta hace y remarca la mandíbula.',
        'Corte con línea recta y perfecta arriba: suma otro ángulo a una cara que ya tiene varios.',
      ],
      beard: [
        'Barba corta y pareja a los costados: ensancha',
        'Redondeada en el mentón, nunca cuadrada',
        'Evitar perilla o barba larga abajo, alarga la cara',
      ],
    },
    mujer: {
      recommended: [
        {
          name: 'Lob con ondas marcadas',
          desc: 'Largo entre el mentón y los hombros, con onda que da cuerpo a los costados.',
          why: 'Corta el largo vertical y las curvas suavizan la mandíbula. Es el corte que mejor resuelve esta forma.',
          tryon: 'a wavy lob ending between chin and shoulders with strong lateral volume and soft waves',
        },
        {
          name: 'Flequillo cortina',
          desc: 'Abierto al medio, cayendo en diagonal hacia los costados.',
          why: 'Acorta la frente y las diagonales rompen las líneas rectas del rostro.',
          tryon: 'curtain bangs parted in the middle falling diagonally, shoulder-length wavy hair',
        },
        {
          name: 'Capas que enmarcan la cara',
          desc: 'Capas que arrancan en el pómulo y caen por delante de la mandíbula.',
          why: 'El pelo por delante de la mandíbula disimula el ángulo y suma ancho arriba.',
          tryon: 'long hair with face-framing layers starting at the cheekbones falling over the jawline',
        },
      ],
      avoid: [
        'Pelo muy largo y liso pegado a la cabeza: estira la cara y deja la mandíbula sola.',
        'Raya al medio sin volumen: refuerza la línea vertical.',
        'Bob recto a la altura de la mandíbula: la subraya al máximo.',
      ],
    },
  },

  corazon: {
    hombre: {
      recommended: [
        {
          name: 'Corte de largo medio que cubre las sienes',
          desc: 'Largo suficiente para tapar parte de la frente y las sienes, con textura.',
          why: 'Reduce visualmente el ancho de la frente, que es lo que desbalancea el rostro corazón.',
          tryon: 'a medium-length textured haircut covering the temples and part of the forehead',
        },
        {
          name: 'Flequillo desfilado hacia un costado',
          desc: 'Flequillo largo cruzando la frente en diagonal.',
          why: 'La diagonal rompe el ancho de la frente sin verse pesada.',
          tryon: 'long side-swept fringe crossing the forehead diagonally, medium-length sides',
        },
        {
          name: 'Largo hasta la mandíbula con capas',
          desc: 'Pelo que llega a la altura del mentón, con movimiento.',
          why: 'Suma volumen justo abajo, donde el rostro corazón se angosta. Equilibra la proporción.',
          tryon: 'jaw-length layered hair with volume around the jawline',
        },
      ],
      avoid: [
        'Peinado tirante hacia atrás: expone la frente ancha al máximo.',
        'Mucho volumen arriba: agranda todavía más la parte de la cara que ya domina.',
        'Costados rapados al ras: adelgazan una mandíbula que ya es angosta.',
      ],
      beard: [
        'Barba tupida en el mentón y la mandíbula: suma el ancho que falta abajo',
        'Barba completa corta',
        'Evitar perilla fina, marca el mentón en punta',
      ],
    },
    mujer: {
      recommended: [
        {
          name: 'Lob con ondas a la altura del mentón',
          desc: 'Largo que termina en la mandíbula, con onda que da cuerpo abajo.',
          why: 'Concentra volumen exactamente donde el rostro corazón es más angosto.',
          tryon: 'a wavy lob ending at the jawline with volume concentrated at the bottom',
        },
        {
          name: 'Flequillo cortina',
          desc: 'Abierto al medio, cayendo hacia los costados de la frente.',
          why: 'Cubre los costados de la frente ancha sin taparla del todo.',
          tryon: 'curtain bangs framing a wide forehead, parted in the middle',
        },
        {
          name: 'Capas largas con volumen bajo',
          desc: 'Largo con las capas concentradas de la mandíbula para abajo.',
          why: 'Equilibra el triángulo invertido sumando peso abajo.',
          tryon: 'long hair with layers concentrated below the jawline, volume at the bottom',
        },
        {
          name: 'Raya al costado',
          desc: 'Raya profunda a un lado en vez de al medio.',
          why: 'La asimetría desvía la atención del ancho de la frente.',
          tryon: 'long hair with a deep side part creating asymmetry',
        },
      ],
      avoid: [
        'Rodete tirante o pelo todo hacia atrás: deja la frente ancha totalmente expuesta.',
        'Volumen concentrado en la coronilla.',
        'Pixie muy corto arriba con nuca al ras: acentúa el contraste frente/mentón.',
      ],
    },
  },

  diamante: {
    hombre: {
      recommended: [
        {
          name: 'Fringe o flequillo con textura',
          desc: 'Pelo hacia adelante que suma ancho en la frente.',
          why: 'La frente angosta es la mitad del desbalance del rostro diamante. El flequillo la ensancha.',
          tryon: 'a textured fringe haircut adding width at the forehead, medium sides',
        },
        {
          name: 'Largo medio con volumen arriba y abajo',
          desc: 'Cuerpo en la coronilla y largo que llega a la mandíbula.',
          why: 'Ensanchar arriba y abajo es lo que aplana el diamante hacia un óvalo.',
          tryon: 'medium-length hair with volume at the crown and length reaching the jawline',
        },
        {
          name: 'Corte con costados no rapados',
          desc: 'Costados mantenidos con algo de peso, sin fade.',
          why: 'Rapar los costados deja los pómulos como único punto ancho, que es justo lo que hay que evitar.',
          tryon: 'a haircut with sides kept at medium length, no fade, soft outline',
        },
      ],
      avoid: [
        'Fade alto o undercut: aísla los pómulos y exagera el ancho del medio.',
        'Peinado hacia atrás sin volumen: deja la frente angosta a la vista.',
      ],
      beard: [
        'Barba llena en la mandíbula: suma ancho en la base',
        'Evitar perilla estrecha',
      ],
    },
    mujer: {
      recommended: [
        {
          name: 'Flequillo cortina o lateral',
          desc: 'Flequillo que cubre y ensancha visualmente la frente.',
          why: 'Compensa la frente angosta, que es la mitad del problema del diamante.',
          tryon: 'curtain bangs adding visual width to a narrow forehead',
        },
        {
          name: 'Bob a la altura del mentón con volumen',
          desc: 'Corte que termina en el mentón, con cuerpo en las puntas.',
          why: 'Suma ancho en la mandíbula, la otra zona angosta.',
          tryon: 'a chin-length bob with volume and body at the ends',
        },
        {
          name: 'Capas largas suaves, sin volumen en el medio',
          desc: 'Largo con capas que evitan sumar cuerpo a la altura de los pómulos.',
          why: 'Los pómulos ya son el punto más ancho: no hay que agregarles nada.',
          tryon: 'long soft layers kept flat at cheekbone level with volume above and below',
        },
      ],
      avoid: [
        'Volumen a la altura de los pómulos: exagera el punto más ancho.',
        'Pelo tirante hacia atrás: deja al descubierto la frente angosta y el mentón en punta.',
      ],
    },
  },

  triangular: {
    hombre: {
      recommended: [
        {
          name: 'Volumen alto en la coronilla',
          desc: 'Quiff o pompadour con buen cuerpo arriba.',
          why: 'La mandíbula domina, así que hay que sumar presencia arriba para equilibrar.',
          tryon: 'a voluminous quiff with high crown volume and tapered sides',
        },
        {
          name: 'Fade bajo con largo arriba',
          desc: 'Degradado suave abajo, peso concentrado en la parte superior.',
          why: 'Afina los costados a la altura de la mandíbula y suma arriba, la corrección exacta.',
          tryon: 'a low fade haircut with substantial length and volume on top',
        },
        {
          name: 'Corte con textura y sienes con cuerpo',
          desc: 'Volumen en las sienes para ensanchar la parte alta de la cara.',
          why: 'Ensanchar la frente reduce el contraste con la mandíbula.',
          tryon: 'a textured haircut with volume kept at the temples widening the upper face',
        },
      ],
      avoid: [
        'Pelo pegado y sin volumen arriba: deja a la mandíbula sola dominando la cara.',
        'Barba tupida y ancha: agranda la parte que ya es más grande.',
      ],
      beard: [
        'Barba muy corta o afeitado prolijo: no sumar ancho abajo',
        'Evitar barba llena en las mejillas',
      ],
    },
    mujer: {
      recommended: [
        {
          name: 'Volumen en la coronilla y capas cortas arriba',
          desc: 'Cuerpo concentrado en la parte alta de la cabeza.',
          why: 'Equilibra el ancho de la mandíbula sumando presencia arriba.',
          tryon: 'hairstyle with strong crown volume and short layers on top, flat at the jaw',
        },
        {
          name: 'Pixie o corte corto con textura arriba',
          desc: 'Corto, con todo el movimiento concentrado en la coronilla.',
          why: 'Invierte la proporción: agranda arriba, despeja abajo.',
          tryon: 'a short textured pixie with volume at the crown and a clean nape',
        },
        {
          name: 'Largo por debajo de los hombros con capas altas',
          desc: 'Si vas por el largo, que las capas arranquen arriba, no en la mandíbula.',
          why: 'Evita sumar peso a la altura de la mandíbula, que ya es la zona más ancha.',
          tryon: 'long hair with layers starting high above the jawline, sleek at the bottom',
        },
      ],
      avoid: [
        'Bob a la altura de la mandíbula: cae justo en el punto más ancho y lo remarca.',
        'Capas o rulos con volumen a la altura del mentón.',
      ],
    },
  },
};

export function getHaircuts(shapeKey, gender) {
  const shape = D[shapeKey] || D.ovalado;
  return shape[gender] || shape.hombre;
}

export const GENDERS = [
  { key: 'hombre', label: 'Hombre' },
  { key: 'mujer', label: 'Mujer' },
];

export default D;
