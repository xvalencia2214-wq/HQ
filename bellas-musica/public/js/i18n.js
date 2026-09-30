import { api } from "./api.js";
import { state } from "./state.js";
import { EN2, ES2 } from "./i18n-new.js";

const EN = {
  "cal.open": "available", "acct.delete": "Delete my account", "acct.deleteWarn": "This signs you out, removes your name, phone and messages, and takes your listings offline. Booking and payment records are kept without your personal details. You can't undo this.", "acct.deletePw": "Type your password to confirm", "acct.deleteBtn": "Delete my account", "acct.deleteConfirm": "Delete your account for good?", "acct.deleted": "Your account was deleted.",
  "nav.admin": "Admin",
  "chk.title": "Get ready to launch", "chk.progress": "{done} of {total} done", "chk.complete": "Your profile is complete. Share it with your customers!",
  "chk.photos": "Add at least 3 photos", "chk.video": "Add a video link", "chk.story": "Write your story (80+ characters)", "chk.events": "Pick the events you play", "chk.songs": "List at least 5 songs",
  "chk.packages": "Add a package", "chk.dates": "Open at least 4 dates", "chk.payouts": "Set up payouts", "chk.alerts": "Turn on text alerts (add your phone and agree to texts)",
  "bk.ics": "Add to calendar",
  "nav.messages": "Messages", "msg.title": "Messages", "msg.none": "No conversations yet. Message a group from its page.", "msg.open": "Open group page", "msg.new": "new", "msg.you": "You",
  "f.more": "More filters", "f.radius": "Distance", "f.miles": "Within {n} miles", "f.clear": "Clear filters", "f.locate": "Use my location", "f.locating": "Finding your ZIP…", "f.locFail": "Couldn't find your location. Type your ZIP instead.",
  "home.searching": "Searching…", "common.loading": "Loading…", "common.sessionExpired": "Your session expired. Please log in again.", "card.nearby": "In your area", "g.checkDates": "Check dates", "nav.menu": "Menu",
  "dash.secNew": "Needs your response", "dash.secUpcoming": "Upcoming", "dash.secPast": "Past & closed", "dash.emptySec": "Nothing here.",
  "nav.find": "Find music", "nav.bookings": "My bookings", "nav.groups": "For groups", "nav.login": "Log in", "nav.signup": "Sign up", "nav.logout": "Log out", "nav.loggedOut": "You're logged out",
  "foot": "Bella's Música · USA only · Deposits are refunded according to each group's cancellation policy.",
  "foot.terms": "Terms", "foot.privacy": "Privacy", "banner.test": "Test mode: no real money moves and texts are not sent.",
  "common.back": "Back", "common.save": "Save", "common.saved": "Saved ✓", "common.send": "Send", "common.delete": "Delete", "common.yes": "Yes", "common.no": "No",
  "common.error": "Something went wrong. Please try again.", "common.notFound": "Not found", "common.confirmDelete": "Delete this?",
  "home.title": "Find the music for your fiesta", "home.sub": "Search local mariachis, bandas and more. Tell us about your event and see who's free.",
  "home.hint": "Enter your ZIP code to see groups near you.", "home.top": "Top groups near {city}", "home.list": "List", "home.map": "Map",
  "home.none": "No groups match that search. Try a different date, fewer filters, or a different ZIP.",
  "map.note": "Pins show the general area, not exact addresses. Tap a pin to see the group.", "map.fail": "The map could not load. Use the list view.", "map.you": "Your ZIP",
  "f.zip": "ZIP code", "f.event": "Event", "f.anyEvent": "Any event", "f.date": "Date", "f.guests": "Guests", "f.song": "A song you want to hear", "f.type": "Type of music",
  "f.any": "Any", "f.max": "Max price / hour", "f.upTo": "Up to {price}", "f.sort": "Sort by", "f.search": "Search",
  "sort.rating": "Top rated", "sort.price": "Lowest price", "sort.distance": "Closest",
  "card.new": "New", "card.from": "From {price}", "card.away": "{n} mi away", "card.members": "{n} musicians", "card.featured": "Featured", "card.sample": "Sample listing",
  "card.fits": "Great for your event", "card.plays": "Plays", "card.open": "Open", "card.book": "See dates & book",
  "share.share": "Share", "share.copied": "Link copied", "share.copy": "Copy this link",
  "best.link": "Best of {city}", "best.title": "Best of {city}, {state}", "best.sub": "The top-rated groups within 40 miles.",
  "g.members": "Musicians", "g.guests": "Best for", "g.upto": "up to {n} guests", "g.set": "Set length", "g.minutes": "{n} min", "g.sound": "Sound system", "g.dress": "Dress code",
  "g.travel": "Travel", "g.travelFree": "Free within {miles} mi", "g.travelFee": "{fee} beyond {miles} mi", "g.deposit": "Deposit", "g.policy": "Cancellation policy",
  "g.story": "Our story", "g.noStory": "This group hasn't added a story yet.", "g.songs": "Songs they play", "g.songFilter": "Search their songs", "g.noSong": "No songs match.",
  "g.packages": "Packages", "g.hours": "{n} hr", "g.choose": "Choose", "g.reviews": "{n} reviews", "g.reviewsTitle": "Reviews from customers", "g.photo": "Photo {n}",
  "g.dates": "Open dates & times", "g.datesHint": "Days with a blue border are open. Tap one to see times.", "g.request": "Request this group", "g.message": "Message the manager",
  "g.pickDate": "Pick an open date and time to start your request.", "g.pickFirst": "Now pick an open date and time.", "g.package": "Package", "g.hourly": "Hourly ({price}/hr)", "g.hoursLabel": "Hours of music",
  "g.eventZip": "Event ZIP code", "g.yourName": "Your name", "g.yourPhone": "Your phone (shared with the group only after they confirm)", "g.address": "Event location (venue or address)",
  "g.special": "Special requests", "g.specialHint": "Songs, surprise timing, dress code…", "g.quoteHint": "Enter guests and the event ZIP to see your price.",
  "g.agree": "I understand the deposit is charged now and refunds follow the cancellation policy above.", "g.mustAgree": "Please accept the deposit and cancellation policy.",
  "g.pay": "Pay deposit & send request", "g.loginToBook": "Log in or create a free account to book.", "g.loginToChat": "Log in to message this group.",
  "g.notBookable": "This group isn't taking online deposits yet. You can still send them a message.", "g.yours": "This is your group.",
  "g.noMsgs": "No messages yet. Say hello.", "g.msgHint": "Ask about songs, location, setup…", "g.privacy": "Phone numbers and emails stay hidden until a booking is confirmed. Everything goes through the app.",
  "g.masked": "For everyone's privacy, contact details are hidden until a booking is confirmed.",
  "q.subtotal": "Music", "q.travel": "Travel fee", "q.total": "Estimated total", "q.deposit": "Deposit today ({pct}%)", "q.balance": "Balance due to the group",
  "q.policyRow": "{days}+ days before the event: {pct}% of the deposit back", "q.policyNone": "Less than that: no refund", "q.declined": "If the group declines your request, you get your full deposit back.",
  "policy.flexible": "Flexible", "policy.moderate": "Moderate", "policy.strict": "Strict",
  "auth.loginTitle": "Log in", "auth.signupTitle": "Create your account", "auth.name": "Your name", "auth.email": "Email", "auth.password": "Password", "auth.pwHint": "At least 8 characters.",
  "auth.phone": "Mobile phone (optional)", "auth.smsConsent": "Text me about my bookings and messages. Message and data rates may apply. Reply STOP to opt out.",
  "auth.have": "Already have an account?", "auth.new": "New here?", "auth.noReset": "Forgot your password? Password reset by email is coming soon; for now contact support.",
  "acct.title": "My account", "acct.profile": "Profile", "acct.password": "Change password", "acct.current": "Current password", "acct.new": "New password", "acct.change": "Change password",
  "acct.others": "Changing your password logs you out on other devices.",
  "bk.title": "My bookings", "bk.none": "No bookings yet.", "bk.detail": "Your booking", "bk.all": "See all bookings", "bk.deposit": "Deposit", "bk.refunded": "{amount} refunded",
  "bk.cancel": "Cancel", "bk.cancelled": "Booking cancelled", "bk.cancelNote": "If you cancel today you get back {amount} ({pct}% of the deposit).",
  "bk.confirmCancel": "Cancel this booking? You will get back {amount}.", "bk.payNow": "Pay deposit", "bk.paidTitle": "Deposit received.", "bk.paidText": "The group will confirm your request. You can message them anytime.",
  "bk.payCancelled": "Payment was cancelled. Your time slot is held for 30 minutes.", "bk.review": "Leave a review", "bk.reviewed": "Reviewed", "bk.rating": "Rating", "bk.comment": "Your review (optional)",
  "bk.submitReview": "Post review", "bk.thanks": "Thanks for your review!",
  "status.pending_payment": "Awaiting payment", "status.requested": "Requested", "status.confirmed": "Confirmed", "status.declined": "Declined", "status.cancelled": "Cancelled", "status.completed": "Completed", "status.expired": "Expired",
  "pay.unpaid": "Unpaid", "pay.paid": "Deposit paid", "pay.refunded": "Refunded", "pay.partial_refund": "Partly refunded",
  "pay.depositFor": "Deposit for {name}", "pay.amount": "Deposit", "pay.testMode": "Test mode: no real card is charged.", "pay.button": "Pay {amount} (test)",
  "pay.featureTitle": "Featured placement (30 days)", "pay.featureText": "Your group appears first in local search and gets more turns in the Discover feed.",
  "cal.prev": "Previous month", "cal.next": "Next month",
  "tab.requests": "Requests", "tab.calendar": "Calendar", "tab.listing": "Profile", "tab.extras": "Packages", "tab.media": "Media", "tab.payments": "Payments", "tab.messages": "Messages",
  "dash.title": "group dashboard", "dash.pick": "Choose group", "dash.add": "Add a group", "dash.view": "View public page",
  "dash.create": "List your group", "dash.createSub": "Get found, take deposits and manage your dates in one place.", "dash.createBtn": "Create listing", "dash.created": "Group created! Now add your open dates.",
  "dash.name": "Group name", "dash.zip": "Home ZIP code", "dash.members": "Number of musicians", "dash.rate": "Price per hour ($)", "dash.maxGuests": "Best for up to (guests)",
  "dash.needPayout": "Set up payouts so customers can pay you deposits.", "dash.setUp": "Set up",
  "dash.noReq": "No requests yet.", "dash.guests": "{n} guests", "dash.phoneLater": "phone shown after you accept", "dash.money": "Deposit {deposit} − fee {fee} = you receive {payout}. Customer pays you {balance} at the event.",
  "dash.accept": "Accept", "dash.decline": "Decline", "dash.confirmDecline": "Decline this request? The customer's deposit is refunded in full.", "dash.confirmCancel": "Cancel this booking? The customer's deposit is refunded in full.",
  "dash.fill": "Open all weekends, next 8 weeks", "dash.clear": "Clear calendar", "dash.confirmClear": "Remove all your future open dates?", "dash.calHint": "Gold-bordered days are open for booking. Tap a day to choose its time slots. Booked slots can't be changed.",
  "dash.slotsFor": "Time slots for {date}", "dash.booked": "booked",
  "dash.eventsDo": "Events you play", "dash.extras": "Extras", "dash.sound": "We bring our own sound system", "dash.setMin": "Set length (minutes)", "dash.travelMiles": "Free travel distance (miles)", "dash.travelFee": "Travel fee beyond that ($)",
  "dash.terms": "Deposit & cancellation", "dash.depositPct": "Deposit (% of total, 20–50)", "dash.contactPhone": "Your phone for text alerts", "dash.contactHint": "Only used to text you about new requests. Customers never see it.",
  "dash.noPkg": "No packages yet.", "dash.addPkg": "Add a package", "dash.pkgName": "Name", "dash.pkgEx": "Serenata, 2-hour party…", "dash.pkgDesc": "Short description", "dash.price": "Price ($)",
  "dash.songsHint": "One song per line. Customers can search for songs.",
  "dash.photos": "Photos", "dash.photosHint": "Photos are resized on your device. The first photo is your cover.", "dash.addPhoto": "+ Add photos", "dash.cover": "Make cover", "dash.isCover": "Cover",
  "dash.video": "Video link", "dash.videoHint": "Paste a link to a video you already posted: YouTube (Shorts too), Vimeo, TikTok or Instagram Reels. A short vertical clip plays in the Discover feed. People book music they can hear.",
  "dash.payouts": "Payouts", "dash.payTest": "Test mode: payouts are simulated.", "dash.payReady": "Payouts are set up. Deposits go to your bank account through Stripe.", "dash.payNeeded": "Finish Stripe setup to receive deposits.",
  "dash.payStart": "Set up payouts", "dash.payContinue": "Continue setup", "dash.feeExplain": "Bella's Música keeps a small platform fee from each booking's deposit; the rest is paid out to you. If a booking is refunded, the fee is refunded too.",
  "dash.featureTitle": "Featured placement", "dash.featureText": "For 30 days you appear first in local search with a Featured badge, and more often in the Discover feed (marked Promoted).", "dash.buyFeature": "Feature my group ({price})",
  "dash.featuredUntil": "Featured until {date}.", "dash.featured": "Your group is now featured!", "dash.noThreads": "No messages yet.",
  "type.Mariachi": "Mariachi", "type.Banda": "Banda", "type.Norteño": "Norteño", "type.Trío romántico": "Romantic trio", "type.Grupera": "Grupera", "type.Conjunto": "Conjunto", "type.DJ": "DJ", "type.Other": "Other",
  "event.Wedding": "Wedding", "event.Quinceañera": "Quinceañera", "event.Birthday": "Birthday", "event.Anniversary": "Anniversary", "event.Serenata": "Serenata", "event.Corporate / Restaurant": "Corporate / Restaurant", "event.Other": "Other"
};

const ES = {
  "cal.open": "disponible", "acct.delete": "Eliminar mi cuenta", "acct.deleteWarn": "Se cierra tu sesión, se borran tu nombre, teléfono y mensajes, y tus perfiles dejan de mostrarse. Los registros de reservas y pagos se conservan sin tus datos personales. No se puede deshacer.", "acct.deletePw": "Escribe tu contraseña para confirmar", "acct.deleteBtn": "Eliminar mi cuenta", "acct.deleteConfirm": "¿Eliminar tu cuenta definitivamente?", "acct.deleted": "Tu cuenta fue eliminada.",
  "nav.admin": "Admin",
  "chk.title": "Prepárate para lanzar", "chk.progress": "{done} de {total} listos", "chk.complete": "Tu perfil está completo. ¡Compártelo con tus clientes!",
  "chk.photos": "Agrega al menos 3 fotos", "chk.video": "Agrega un enlace de video", "chk.story": "Escribe tu historia (80+ caracteres)", "chk.events": "Elige los eventos que tocas", "chk.songs": "Lista al menos 5 canciones",
  "chk.packages": "Agrega un paquete", "chk.dates": "Abre al menos 4 fechas", "chk.payouts": "Configura tus pagos", "chk.alerts": "Activa los avisos por texto (agrega tu teléfono y acepta los textos)",
  "bk.ics": "Agregar al calendario",
  "nav.messages": "Mensajes", "msg.title": "Mensajes", "msg.none": "Aún no tienes conversaciones. Escríbele a un grupo desde su página.", "msg.open": "Abrir página del grupo", "msg.new": "nuevo", "msg.you": "Tú",
  "f.more": "Más filtros", "f.radius": "Distancia", "f.miles": "A menos de {n} millas", "f.clear": "Quitar filtros", "f.locate": "Usar mi ubicación", "f.locating": "Buscando tu código postal…", "f.locFail": "No pudimos encontrar tu ubicación. Escribe tu código postal.",
  "home.searching": "Buscando…", "common.loading": "Cargando…", "common.sessionExpired": "Tu sesión expiró. Inicia sesión de nuevo.", "card.nearby": "En tu zona", "g.checkDates": "Ver fechas", "nav.menu": "Menú",
  "dash.secNew": "Esperan tu respuesta", "dash.secUpcoming": "Próximas", "dash.secPast": "Pasadas y cerradas", "dash.emptySec": "Nada aquí.",
  "nav.find": "Buscar música", "nav.bookings": "Mis reservas", "nav.groups": "Para grupos", "nav.login": "Iniciar sesión", "nav.signup": "Crear cuenta", "nav.logout": "Cerrar sesión", "nav.loggedOut": "Cerraste sesión",
  "foot": "Bella's Música · Solo EE. UU. · Los depósitos se reembolsan según la política de cancelación de cada grupo.",
  "foot.terms": "Términos", "foot.privacy": "Privacidad", "banner.test": "Modo de prueba: no se mueve dinero real y no se envían mensajes de texto.",
  "common.back": "Regresar", "common.save": "Guardar", "common.saved": "Guardado ✓", "common.send": "Enviar", "common.delete": "Eliminar", "common.yes": "Sí", "common.no": "No",
  "common.error": "Algo salió mal. Inténtalo de nuevo.", "common.notFound": "No se encontró", "common.confirmDelete": "¿Eliminar esto?",
  "home.title": "Encuentra la música para tu fiesta", "home.sub": "Busca mariachis, bandas y más cerca de ti. Cuéntanos de tu evento y mira quién está libre.",
  "home.hint": "Escribe tu código postal para ver grupos cerca de ti.", "home.top": "Mejores grupos cerca de {city}", "home.list": "Lista", "home.map": "Mapa",
  "home.none": "Ningún grupo coincide con esa búsqueda. Prueba otra fecha, menos filtros u otro código postal.",
  "map.note": "Los pines muestran la zona general, no direcciones exactas. Toca un pin para ver el grupo.", "map.fail": "No se pudo cargar el mapa. Usa la vista de lista.", "map.you": "Tu código postal",
  "f.zip": "Código postal", "f.event": "Evento", "f.anyEvent": "Cualquier evento", "f.date": "Fecha", "f.guests": "Invitados", "f.song": "Una canción que quieres escuchar", "f.type": "Tipo de música",
  "f.any": "Cualquiera", "f.max": "Precio máximo por hora", "f.upTo": "Hasta {price}", "f.sort": "Ordenar por", "f.search": "Buscar",
  "sort.rating": "Mejor calificados", "sort.price": "Menor precio", "sort.distance": "Más cercanos",
  "card.new": "Nuevo", "card.from": "Desde {price}", "card.away": "a {n} mi", "card.members": "{n} músicos", "card.featured": "Destacado", "card.sample": "Ejemplo",
  "card.fits": "Ideal para tu evento", "card.plays": "Toca", "card.open": "Disponible", "card.book": "Ver fechas y reservar",
  "share.share": "Compartir", "share.copied": "Enlace copiado", "share.copy": "Copia este enlace",
  "best.link": "Lo mejor de {city}", "best.title": "Lo mejor de {city}, {state}", "best.sub": "Los grupos mejor calificados a menos de 40 millas.",
  "g.members": "Músicos", "g.guests": "Ideal para", "g.upto": "hasta {n} invitados", "g.set": "Duración del set", "g.minutes": "{n} min", "g.sound": "Equipo de sonido", "g.dress": "Vestimenta",
  "g.travel": "Viaje", "g.travelFree": "Gratis dentro de {miles} mi", "g.travelFee": "{fee} después de {miles} mi", "g.deposit": "Depósito", "g.policy": "Política de cancelación",
  "g.story": "Nuestra historia", "g.noStory": "Este grupo aún no ha agregado su historia.", "g.songs": "Canciones que tocan", "g.songFilter": "Buscar sus canciones", "g.noSong": "Ninguna canción coincide.",
  "g.packages": "Paquetes", "g.hours": "{n} h", "g.choose": "Elegir", "g.reviews": "{n} reseñas", "g.reviewsTitle": "Reseñas de clientes", "g.photo": "Foto {n}",
  "g.dates": "Fechas y horarios disponibles", "g.datesHint": "Los días con borde azul están disponibles. Toca uno para ver los horarios.", "g.request": "Solicitar este grupo", "g.message": "Escríbele al representante",
  "g.pickDate": "Elige una fecha y hora disponibles para empezar tu solicitud.", "g.pickFirst": "Ahora elige una fecha y hora disponibles.", "g.package": "Paquete", "g.hourly": "Por hora ({price}/h)", "g.hoursLabel": "Horas de música",
  "g.eventZip": "Código postal del evento", "g.yourName": "Tu nombre", "g.yourPhone": "Tu teléfono (se comparte con el grupo solo cuando confirme)", "g.address": "Lugar del evento (salón o dirección)",
  "g.special": "Peticiones especiales", "g.specialHint": "Canciones, sorpresas, vestimenta…", "g.quoteHint": "Escribe los invitados y el código postal del evento para ver tu precio.",
  "g.agree": "Entiendo que el depósito se cobra ahora y que los reembolsos siguen la política de cancelación de arriba.", "g.mustAgree": "Acepta el depósito y la política de cancelación.",
  "g.pay": "Pagar depósito y enviar solicitud", "g.loginToBook": "Inicia sesión o crea una cuenta gratis para reservar.", "g.loginToChat": "Inicia sesión para escribirle a este grupo.",
  "g.notBookable": "Este grupo aún no acepta depósitos en línea. Todavía puedes enviarle un mensaje.", "g.yours": "Este es tu grupo.",
  "g.noMsgs": "Aún no hay mensajes. Saluda.", "g.msgHint": "Pregunta por canciones, lugar, equipo…", "g.privacy": "Los teléfonos y correos permanecen ocultos hasta que se confirme una reserva. Todo se hace por la app.",
  "g.masked": "Por privacidad de todos, los datos de contacto se ocultan hasta que se confirme una reserva.",
  "q.subtotal": "Música", "q.travel": "Cargo por viaje", "q.total": "Total estimado", "q.deposit": "Depósito hoy ({pct}%)", "q.balance": "Saldo a pagar al grupo",
  "q.policyRow": "{days}+ días antes del evento: te devuelven el {pct}% del depósito", "q.policyNone": "Con menos tiempo: sin reembolso", "q.declined": "Si el grupo rechaza tu solicitud, te devolvemos todo el depósito.",
  "policy.flexible": "Flexible", "policy.moderate": "Moderada", "policy.strict": "Estricta",
  "auth.loginTitle": "Iniciar sesión", "auth.signupTitle": "Crea tu cuenta", "auth.name": "Tu nombre", "auth.email": "Correo electrónico", "auth.password": "Contraseña", "auth.pwHint": "Al menos 8 caracteres.",
  "auth.phone": "Celular (opcional)", "auth.smsConsent": "Envíenme mensajes de texto sobre mis reservas y mensajes. Pueden aplicar tarifas de mensajes y datos. Responde STOP para cancelar.",
  "auth.have": "¿Ya tienes cuenta?", "auth.new": "¿Eres nuevo?", "auth.noReset": "¿Olvidaste tu contraseña? El restablecimiento por correo llegará pronto; por ahora contacta a soporte.",
  "acct.title": "Mi cuenta", "acct.profile": "Perfil", "acct.password": "Cambiar contraseña", "acct.current": "Contraseña actual", "acct.new": "Contraseña nueva", "acct.change": "Cambiar contraseña",
  "acct.others": "Al cambiar tu contraseña se cierra la sesión en otros dispositivos.",
  "bk.title": "Mis reservas", "bk.none": "Aún no tienes reservas.", "bk.detail": "Tu reserva", "bk.all": "Ver todas mis reservas", "bk.deposit": "Depósito", "bk.refunded": "{amount} reembolsados",
  "bk.cancel": "Cancelar", "bk.cancelled": "Reserva cancelada", "bk.cancelNote": "Si cancelas hoy te devuelven {amount} ({pct}% del depósito).",
  "bk.confirmCancel": "¿Cancelar esta reserva? Te devolverán {amount}.", "bk.payNow": "Pagar depósito", "bk.paidTitle": "Depósito recibido.", "bk.paidText": "El grupo confirmará tu solicitud. Puedes escribirles cuando quieras.",
  "bk.payCancelled": "Se canceló el pago. Tu horario se reserva por 30 minutos.", "bk.review": "Dejar una reseña", "bk.reviewed": "Reseñado", "bk.rating": "Calificación", "bk.comment": "Tu reseña (opcional)",
  "bk.submitReview": "Publicar reseña", "bk.thanks": "¡Gracias por tu reseña!",
  "status.pending_payment": "Esperando pago", "status.requested": "Solicitada", "status.confirmed": "Confirmada", "status.declined": "Rechazada", "status.cancelled": "Cancelada", "status.completed": "Completada", "status.expired": "Vencida",
  "pay.unpaid": "Sin pagar", "pay.paid": "Depósito pagado", "pay.refunded": "Reembolsado", "pay.partial_refund": "Reembolso parcial",
  "pay.depositFor": "Depósito para {name}", "pay.amount": "Depósito", "pay.testMode": "Modo de prueba: no se cobra ninguna tarjeta real.", "pay.button": "Pagar {amount} (prueba)",
  "pay.featureTitle": "Lugar destacado (30 días)", "pay.featureText": "Tu grupo aparece primero en las búsquedas locales y sale más veces en Descubre.",
  "cal.prev": "Mes anterior", "cal.next": "Mes siguiente",
  "tab.requests": "Solicitudes", "tab.calendar": "Calendario", "tab.listing": "Perfil", "tab.extras": "Paquetes", "tab.media": "Fotos y video", "tab.payments": "Pagos", "tab.messages": "Mensajes",
  "dash.title": "panel del grupo", "dash.pick": "Elegir grupo", "dash.add": "Agregar un grupo", "dash.view": "Ver página pública",
  "dash.create": "Publica tu grupo", "dash.createSub": "Que te encuentren, cobra depósitos y maneja tus fechas en un solo lugar.", "dash.createBtn": "Crear perfil", "dash.created": "¡Grupo creado! Ahora agrega tus fechas disponibles.",
  "dash.name": "Nombre del grupo", "dash.zip": "Código postal de origen", "dash.members": "Número de músicos", "dash.rate": "Precio por hora ($)", "dash.maxGuests": "Ideal hasta (invitados)",
  "dash.needPayout": "Configura tus pagos para que los clientes puedan pagarte depósitos.", "dash.setUp": "Configurar",
  "dash.noReq": "Aún no hay solicitudes.", "dash.guests": "{n} invitados", "dash.phoneLater": "el teléfono aparece cuando aceptes", "dash.money": "Depósito {deposit} − comisión {fee} = tú recibes {payout}. El cliente te paga {balance} el día del evento.",
  "dash.accept": "Aceptar", "dash.decline": "Rechazar", "dash.confirmDecline": "¿Rechazar esta solicitud? El depósito del cliente se reembolsa completo.", "dash.confirmCancel": "¿Cancelar esta reserva? El depósito del cliente se reembolsa completo.",
  "dash.fill": "Abrir todos los fines de semana, próximas 8 semanas", "dash.clear": "Borrar calendario", "dash.confirmClear": "¿Quitar todas tus fechas futuras disponibles?", "dash.calHint": "Los días con borde dorado están abiertos para reservar. Toca un día para elegir sus horarios. Los horarios reservados no se pueden cambiar.",
  "dash.slotsFor": "Horarios para {date}", "dash.booked": "reservado",
  "dash.eventsDo": "Eventos que tocas", "dash.extras": "Extras", "dash.sound": "Llevamos nuestro propio equipo de sonido", "dash.setMin": "Duración del set (minutos)", "dash.travelMiles": "Distancia de viaje gratis (millas)", "dash.travelFee": "Cargo por viaje después de eso ($)",
  "dash.terms": "Depósito y cancelación", "dash.depositPct": "Depósito (% del total, 20–50)", "dash.contactPhone": "Tu teléfono para avisos por texto", "dash.contactHint": "Solo se usa para avisarte de nuevas solicitudes. Los clientes nunca lo ven.",
  "dash.noPkg": "Aún no hay paquetes.", "dash.addPkg": "Agregar un paquete", "dash.pkgName": "Nombre", "dash.pkgEx": "Serenata, fiesta de 2 horas…", "dash.pkgDesc": "Descripción corta", "dash.price": "Precio ($)",
  "dash.songsHint": "Una canción por línea. Los clientes pueden buscar canciones.",
  "dash.photos": "Fotos", "dash.photosHint": "Las fotos se reducen en tu dispositivo. La primera foto es tu portada.", "dash.addPhoto": "+ Agregar fotos", "dash.cover": "Hacer portada", "dash.isCover": "Portada",
  "dash.video": "Enlace de video", "dash.videoHint": "Pega el enlace de un video que ya publicaste: YouTube (también Shorts), Vimeo, TikTok o Reels de Instagram. Un clip vertical corto se reproduce en Descubre. La gente contrata la música que puede escuchar.",
  "dash.payouts": "Pagos", "dash.payTest": "Modo de prueba: los pagos son simulados.", "dash.payReady": "Tus pagos están configurados. Los depósitos llegan a tu cuenta bancaria por Stripe.", "dash.payNeeded": "Termina la configuración de Stripe para recibir depósitos.",
  "dash.payStart": "Configurar pagos", "dash.payContinue": "Continuar configuración", "dash.feeExplain": "Bella's Música se queda con una pequeña comisión del depósito de cada reserva; el resto se te paga a ti. Si se reembolsa una reserva, la comisión también se reembolsa.",
  "dash.featureTitle": "Lugar destacado", "dash.featureText": "Por 30 días apareces primero en las búsquedas locales con una insignia de Destacado, y más seguido en Descubre (marcado como Promocionado).", "dash.buyFeature": "Destacar mi grupo ({price})",
  "dash.featuredUntil": "Destacado hasta el {date}.", "dash.featured": "¡Tu grupo ahora está destacado!", "dash.noThreads": "Aún no hay mensajes.",
  "type.Mariachi": "Mariachi", "type.Banda": "Banda", "type.Norteño": "Norteño", "type.Trío romántico": "Trío romántico", "type.Grupera": "Grupera", "type.Conjunto": "Conjunto", "type.DJ": "DJ", "type.Other": "Otro",
  "event.Wedding": "Boda", "event.Quinceañera": "Quinceañera", "event.Birthday": "Cumpleaños", "event.Anniversary": "Aniversario", "event.Serenata": "Serenata", "event.Corporate / Restaurant": "Corporativo / Restaurante", "event.Other": "Otro"
};

Object.assign(EN, EN2); Object.assign(ES, ES2);
export const DICT = { en: EN, es: ES };
let current = "en";
let onLang = () => {};

export function initLang(cb) {
  onLang = cb;
  let saved = null;
  try { saved = localStorage.getItem("bm_lang"); } catch { /* storage blocked */ }
  current = saved === "es" || saved === "en" ? saved : (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
  document.documentElement.lang = current;
}
export const lang = () => current;

export function setLang(l, { persist = true } = {}) {
  if (l !== "en" && l !== "es") return;
  current = l;
  document.documentElement.lang = l;
  if (persist) {
    try { localStorage.setItem("bm_lang", l); } catch { /* storage blocked */ }
    if (state.user) api.patch("/api/me", { lang: l }).catch(() => {});
  }
  onLang();
}

export function t(key, vars) {
  let s = DICT[current][key] ?? EN[key];
  if (s === undefined) { console.warn("missing translation:", key); return key; }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
