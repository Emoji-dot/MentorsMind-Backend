#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ERROR_CODES_PATH = path.join(ROOT, 'src', 'errors', 'error-codes.ts');
const LOCALES_DIR = path.join(ROOT, 'src', 'locales');

// ---------------------------------------------------------------------------
// 1. Extract ErrorCode enum values (string values)
// ---------------------------------------------------------------------------
function extractEnumValues(src) {
  const values = [];
  const re = /(\w+)\s*=\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    values.push(m[2]);
  }
  return values;
}

// ---------------------------------------------------------------------------
// 2. Extract default English messages from ERROR_CATALOG entry() calls
//    entry(ErrorCode.XXX, status, 'message') -> { XXX: 'message' }
// ---------------------------------------------------------------------------
function extractCatalogMessages(src) {
  const messages = {};
  // Match: entry(ErrorCode.SOME_CODE, 400, 'The message text')
  const re = /entry\(ErrorCode\.(\w+),\s*\d+,\s*'((?:[^'\\]|\\.)*)'\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    messages[m[1]] = m[2].replace(/\\'/g, "'");
  }
  return messages;
}

// ---------------------------------------------------------------------------
// 3. Read or create locale errors.json
// ---------------------------------------------------------------------------
function readLocaleErrors(locale) {
  const filePath = path.join(LOCALES_DIR, locale, 'errors.json');
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return {};
}

function writeLocaleErrors(locale, data) {
  const dir = path.join(LOCALES_DIR, locale);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, 'errors.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return filePath;
}

// ---------------------------------------------------------------------------
// 4. Hardcoded Spanish translations for ALL error codes
// ---------------------------------------------------------------------------
const ES_TRANSLATIONS = {
  // Authentication
  AUTH_UNAUTHORIZED: 'Acceso no autorizado',
  AUTH_AUTHENTICATION_REQUIRED: 'Autenticación requerida',
  AUTH_INVALID_CREDENTIALS: 'Correo electrónico o contraseña inválidos',
  AUTH_EMAIL_ALREADY_REGISTERED: 'El correo electrónico ya está registrado',
  AUTH_TOKEN_EXPIRED: 'Sesión expirada. Por favor, inicia sesión nuevamente',
  AUTH_TOKEN_INVALID: 'Token de sesión inválido',
  AUTH_REFRESH_TOKEN_INVALID: 'Token de actualización inválido o expirado',
  AUTH_ACCOUNT_BANNED: 'Tu cuenta ha sido permanentemente baneada. Por favor, contacta al soporte si crees que esto es un error.',
  AUTH_ACCOUNT_SUSPENDED: 'Tu cuenta ha sido suspendida. Por favor, contacta al soporte para más información.',
  AUTH_ACCOUNT_INACTIVE: 'La cuenta no está activa',
  AUTH_ACCOUNT_LOCKED: 'La cuenta ha sido bloqueada',
  AUTH_EMAIL_NOT_VERIFIED: 'Dirección de correo electrónico no verificada',
  AUTH_MFA_REQUIRED: 'Autenticación de dos factores requerida',
  AUTH_MFA_INVALID: 'Código de verificación inválido',
  AUTH_MFA_TOKEN_INVALID: 'Token MFA inválido o expirado',
  AUTH_INVALID_RESET_TOKEN: 'Token de restablecimiento inválido o expirado',
  AUTH_PASSWORD_MISMATCH: 'Las contraseñas no coinciden',
  AUTH_WEAK_PASSWORD: 'La contraseña es muy débil',

  // Authorization
  AUTHZ_FORBIDDEN: 'Acceso denegado',
  AUTHZ_ACCESS_DENIED: 'No tienes acceso a este recurso',
  AUTHZ_INSUFFICIENT_PERMISSIONS: 'No tienes permiso para realizar esta acción',
  AUTHZ_ADMIN_ONLY: 'Esta acción requiere privilegios de administrador',
  AUTHZ_RESOURCE_OWNERSHIP_REQUIRED: 'Solo el propietario del recurso puede realizar esta acción',

  // Bookings
  BOOKING_CONFLICT: 'El mentor no está disponible en el horario solicitado',
  BOOKING_NOT_FOUND: 'Reserva no encontrada',
  BOOKING_MENTEE_NOT_FOUND: 'Mentee no encontrado',
  BOOKING_MENTOR_NOT_FOUND: 'Mentor no encontrado',
  BOOKING_USER_SUSPENDED: 'Tu cuenta está suspendida. No puedes crear reservas en este momento.',
  BOOKING_USER_BANNED: 'Tu cuenta ha sido permanentemente baneada.',
  BOOKING_USER_NOT_A_MENTOR: 'El usuario no es un mentor',
  BOOKING_MENTOR_PROFILE_NOT_FOUND: 'Perfil del mentor o tarifa por hora no encontrados',
  BOOKING_HOURLY_RATE_NOT_SET: 'Perfil del mentor o tarifa por hora no encontrados',
  BOOKING_INVALID_STATUS: 'No se puede actualizar la reserva en el estado actual',
  BOOKING_ONLY_MENTEE_CAN_UPDATE: 'Solo el mentee puede actualizar los detalles de la reserva',
  BOOKING_ONLY_MENTOR_CAN_CONFIRM: 'Solo el mentor puede confirmar reservas',
  BOOKING_NOT_PENDING: 'La reserva no está en estado pendiente',
  BOOKING_PAYMENT_REQUIRED_BEFORE_CONFIRMATION: 'El pago debe completarse antes de la confirmación',
  BOOKING_NOT_CONFIRMED: 'Solo las reservas confirmadas pueden completarse',
  BOOKING_SESSION_NOT_ENDED: 'No se puede completar la reserva antes de que termine la sesión',
  BOOKING_ALREADY_CANCELLED: 'No se puede cancelar la reserva en el estado actual',
  BOOKING_RESCHEDULE_NOT_ALLOWED: 'No se puede reprogramar la reserva en el estado actual',
  BOOKING_UPDATE_FAILED: 'Error al actualizar la reserva',
  BOOKING_CONFIRM_FAILED: 'Error al confirmar la reserva',
  BOOKING_COMPLETION_FAILED: 'Error al completar la reserva',
  BOOKING_CANCELLATION_FAILED: 'Error al cancelar la reserva',
  BOOKING_RESCHEDULE_FAILED: 'Error al reprogramar la reserva',

  // Payments
  PAYMENT_BOOKING_NOT_FOUND: 'Reserva no encontrada',
  PAYMENT_ACCESS_DENIED: 'Acceso denegado',
  PAYMENT_ALREADY_COMPLETED: 'La reserva ya está pagada',
  PAYMENT_ALREADY_CONFIRMED: 'Pago ya confirmado',
  PAYMENT_ALREADY_REFUNDED: 'Pago ya reembolsado',
  PAYMENT_NOT_FOUND: 'Pago no encontrado',
  PAYMENT_INVALID_STATUS: 'El pago no puede procesarse en su estado actual',
  PAYMENT_REFUND_NOT_ALLOWED: 'Solo los pagos completados pueden reembolsarse',
  PAYMENT_UNSUPPORTED_CURRENCY: 'Moneda no soportada',
  PAYMENT_INVALID_TX_HASH: 'Formato de hash de transacción Stellar inválido',
  PAYMENT_TX_VERIFICATION_FAILED: 'No se pudo verificar la transacción en la red Stellar',
  PAYMENT_TX_TOO_OLD: 'La transacción es demasiado antigua para confirmar (debe ser dentro de 24 horas)',
  PAYMENT_TX_NOT_SUCCESSFUL: 'La transacción Stellar no fue exitosa',
  PAYMENT_SOURCE_ACCOUNT_MISMATCH: 'La cuenta de origen de la transacción no coincide con el remitente del pago',
  PAYMENT_NO_MATCHING_OPERATION: 'La transacción no contiene una operación de pago coincidente',
  PAYMENT_CONFIRM_FAILED: 'Error al confirmar el pago',
  PAYMENT_QUOTE_EXPIRED: 'La cotización ha expirado o no es válida',

  // Escrow
  ESCROW_NOT_FOUND: 'Depósito en garantía no encontrado',
  ESCROW_CREATION_FAILED: 'Error al crear el depósito en garantía',
  ESCROW_RELEASE_FAILED: 'Error al liberar los fondos del depósito en garantía',
  ESCROW_REFUND_FAILED: 'Error al reembolsar los fondos del depósito en garantía',
  ESCROW_ALREADY_RELEASED: 'Los fondos del depósito en garantía ya han sido liberados',
  ESCROW_DISPUTE_RESOLUTION_FAILED: 'Error al resolver la disputa del depósito en garantía',
  ESCROW_METADATA_MISSING: 'No se encontraron metadatos del depósito en garantía en la reserva',

  // Disputes
  DISPUTE_SESSION_NOT_FOUND: 'Sesión no encontrada',
  DISPUTE_NOT_FOUND: 'Disputa no encontrada',
  DISPUTE_CREATION_FAILED: 'Error al crear la disputa',
  DISPUTE_UNAUTHORIZED: 'No autorizado: No eres parte de esta disputa',
  DISPUTE_ESCROW_MISSING: 'No se encontró depósito en garantía para la reserva',
  DISPUTE_INVALID_STATUS_TRANSITION: 'La disputa no puede cambiar al estado solicitado',
  DISPUTE_UPDATE_FAILED: 'Error al actualizar el estado de la disputa',

  // Users
  USER_NOT_FOUND: 'Usuario no encontrado',
  USER_ACCESS_DENIED: 'Acceso denegado',
  USER_UPDATE_FAILED: 'Error al actualizar el usuario',
  USER_PROFILE_INCOMPLETE: 'El perfil del usuario está incompleto',
  USER_DEACTIVATION_FAILED: 'Error al desactivar la cuenta',
  USER_PII_ENCRYPTION_FAILED: 'Error al cifrar los datos personales',

  // Mentors
  MENTOR_NOT_FOUND: 'Mentor no encontrado',
  MENTOR_NOT_AVAILABLE: 'Este mentor no está disponible actualmente para reservas',
  MENTOR_PROFILE_UPDATE_FAILED: 'Error al actualizar el perfil del mentor',
  MENTOR_VERIFICATION_PENDING: 'La verificación del mentor está pendiente de revisión',
  MENTOR_INVALID_GROUP_BY: 'Valor groupBy inválido',

  // Validation
  VALIDATION_ERROR: 'Error de validación',
  VALIDATION_REQUIRED_FIELD: '{{field}} es requerido',
  VALIDATION_INVALID_FORMAT: '{{field}} tiene formato inválido',
  VALIDATION_OUT_OF_RANGE: '{{field}} está fuera de rango',
  VALIDATION_PROGRESS_OUT_OF_RANGE: 'El progreso debe ser un número entre 0 y 100',
  VALIDATION_INVALID_TIMEFRAME: 'Plazo inválido. Debe ser uno de: week, month, quarter, year, all',
  VALIDATION_MISSING_QUERY_PARAMS: 'Faltan parámetros de consulta requeridos',
  VALIDATION_MISSING_OAUTH_STATE: 'Falta el código o estado de OAuth',
  VALIDATION_INVALID_OAUTH_STATE: 'Formato de estado OAuth inválido',

  // OAuth / Integrations
  OAUTH_GOOGLE_ERROR: 'La autorización de Google OAuth falló',
  OAUTH_CSRF_TOKEN_INVALID: 'Token CSRF inválido o expirado',
  INTEGRATION_JOB_NOT_FOUND: 'Trabajo no encontrado',
  ZAPIER_SCOPE_MISSING: 'Falta el alcance requerido en la clave API',

  // Uploads / Attachments
  UPLOAD_FAILED: 'Error al cargar el archivo',
  UPLOAD_FILE_TOO_LARGE: 'Archivo demasiado grande',
  UPLOAD_INVALID_TYPE: 'Tipo de archivo inválido',
  UPLOAD_QUOTA_EXCEEDED: 'Cuota diaria de carga excedida',

  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'Has excedido el límite de solicitudes',

  // Infrastructure / Generic
  BAD_REQUEST: 'Solicitud incorrecta',
  NOT_FOUND: 'Recurso no encontrado',
  CONFLICT: 'Conflicto de recurso',
  INTERNAL_SERVER_ERROR: 'Error interno del servidor',
  SERVICE_UNAVAILABLE: 'Servicio temporalmente no disponible',
  CIRCUIT_BREAKER_OPEN: 'El circuito breaker de la base de datos está abierto',
  DATABASE_CONNECTION_FAILED: 'Error de conexión a la base de datos',
  DATABASE_QUERY_TIMEOUT: 'La consulta a la base de datos ha expirado',
  DATABASE_UNIQUE_VIOLATION: 'Ya existe un registro con estos detalles',
  DATABASE_FOREIGN_KEY_VIOLATION: 'El registro referenciado no existe',
  RESOURCE_NOT_FOUND: 'Recurso no encontrado',
  DUPLICATE_REQUEST: 'Solicitud duplicada',
  MAINTENANCE_MODE: 'Sistema en mantenimiento',

  // Learning Paths
  LEARNING_PATH_NOT_FOUND: 'Ruta de aprendizaje no encontrada',
  LEARNING_PATH_NOT_PUBLISHED: 'La ruta de aprendizaje no está publicada',
  LEARNING_PATH_ALREADY_PUBLISHED: 'La ruta de aprendizaje ya está publicada',
  LEARNING_PATH_HAS_ACTIVE_ENROLLMENTS: 'No se puede modificar la ruta de aprendizaje con inscripciones activas',
  LEARNING_PATH_NO_MILESTONES: 'La ruta de aprendizaje debe tener al menos un hito para publicarse',
  LEARNING_PATH_CLONING_NOT_ALLOWED: 'La ruta no está disponible para clonar',
  LEARNING_PATH_TEMPLATE_NOT_FOUND: 'Ruta de plantilla no encontrada',
  LEARNING_PATH_UPDATE_FAILED: 'Error al actualizar la ruta de aprendizaje',
  LEARNING_PATH_DELETE_FAILED: 'Error al eliminar la ruta de aprendizaje',
  LEARNING_PATH_PUBLISH_FAILED: 'Error al publicar la ruta de aprendizaje',
  LEARNING_PATH_UNPUBLISH_FAILED: 'Error al despublicar la ruta de aprendizaje',
  LEARNING_PATH_NOT_ENROLLED: 'No estás inscrito en esta ruta de aprendizaje',
  LEARNING_PATH_NOT_COMPLETED: 'La ruta de aprendizaje no está completada o la inscripción no fue encontrada',
  PATH_ID_REQUIRED: 'El ID de la ruta es requerido',
  MILESTONE_ID_REQUIRED: 'El ID del hito es requerido',

  // Enrollment
  ENROLLMENT_NOT_FOUND: 'Inscripción no encontrada',
  ENROLLMENT_ALREADY_EXISTS: 'El estudiante ya está inscrito en esta ruta de aprendizaje',
  ENROLLMENT_ALREADY_UNENROLLED: 'El estudiante ya está desinscrito',
  ENROLLMENT_STATUS_TRANSITION_INVALID: 'La transición de estado de inscripción no está permitida',
  ENROLLMENT_UPDATE_FAILED: 'Error al actualizar el estado de inscripción',
  STUDENT_NOT_FOUND: 'Estudiante no encontrado',
  STUDENT_ACCOUNT_INACTIVE: 'La cuenta del estudiante no está activa',
  ENROLLMENT_ACCESS_DENIED: 'Acceso denegado a esta inscripción',

  // Milestones
  MILESTONE_NOT_FOUND: 'Hito no encontrado',
  MILESTONE_ALREADY_COMPLETED: 'El hito ya está completado',
  MILESTONE_COMPLETION_FAILED: 'Error al completar el hito',
  MILESTONE_PREREQUISITES_NOT_MET: 'Los prerrequisitos no se cumplen para este hito',
  MILESTONE_STEP_PREREQUISITES_NOT_MET: 'Los prerrequisitos del paso no se cumplen',
  MILESTONE_STEP_INVALID: 'ID de paso inválido',
  MILESTONE_ACCESS_DENIED: 'Acceso denegado a este hito',
  PREREQUISITE_NOT_FOUND: 'Prerrequisito no encontrado',
  PREREQUISITE_OVERRIDE_NOT_FOUND: 'Excepción no encontrada',
  PREREQUISITE_OVERRIDE_EXISTS: 'Ya existe una excepción para este prerrequisito',
  PREREQUISITE_OVERRIDE_PERMISSION_DENIED: 'Solo el mentor puede gestionar las excepciones de prerrequisitos',

  // Certifications / Certificates
  CERTIFICATION_TYPE_NOT_FOUND: 'Tipo de certificación no encontrado',
  CERTIFICATION_NOT_FOUND: 'Certificación no encontrada',
  CERTIFICATION_ALREADY_EXISTS: 'Ya existe una certificación para este mentor',
  CERTIFICATE_NOT_FOUND: 'Certificado no encontrado',
  CERTIFICATE_ALREADY_EXISTS: 'El certificado ya existe',
  CERTIFICATE_REVOKE_PERMISSION_DENIED: 'Permisos insuficientes para revocar el certificado',
  CERTIFICATE_MILESTONES_INCOMPLETE: 'Todos los hitos deben completarse antes de generar el certificado',

  // Reviews
  REVIEW_NOT_FOUND: 'Reseña no encontrada',
  REVIEW_ALREADY_EXISTS: 'La reseña ya existe',
  REVIEW_VOTE_DUPLICATE: 'Ya has votado en esta reseña',
  REVIEW_FLAG_DUPLICATE: 'Ya has marcado esta reseña',
  REVIEW_SELF_INTERACTION_FORBIDDEN: 'No puedes interactuar con tu propia reseña',
  REVIEW_RESPONSE_NOT_FOUND: 'Respuesta a la reseña no encontrada',
  REVIEW_RESPONSE_CREATE_FAILED: 'Error al crear la respuesta a la reseña',
  REVIEW_EDIT_FORBIDDEN: 'No estás autorizado para editar esta reseña',
  REVIEW_DELETE_FORBIDDEN: 'No estás autorizado para eliminar esta reseña',
  SELF_REVIEW_FORBIDDEN: 'No puedes reseñar tu propia entrega',

  // Study Groups / Forums
  STUDY_GROUP_NOT_FOUND: 'Grupo de estudio no encontrado o acceso denegado',
  STUDY_GROUP_FULL: 'El grupo de estudio está lleno',
  STUDY_GROUP_MEMBER_EXISTS: 'El usuario ya es miembro de este grupo de estudio',
  STUDY_GROUP_ENROLLMENT_REQUIRED: 'Debes estar inscrito en la ruta de aprendizaje para unirte al grupo de estudio',
  FORUM_NOT_FOUND: 'Foro no encontrado o acceso denegado',
  FORUM_ALREADY_EXISTS: 'Ya existe un foro para este hito',
  FORUM_POST_DENIED: 'Acceso denegado para publicar en este foro',

  // Payments (learning-path purchases, etc.)
  PAYMENT_REFERENCE_ALREADY_USED: 'La referencia de pago ya ha sido utilizada',
  PAYMENT_INSUFFICIENT_AMOUNT: 'El monto del pago es insuficiente',
  PAYMENT_CURRENCY_MISMATCH: 'La moneda del pago no coincide con la moneda esperada',
  PAYMENT_REQUIRED: 'Pago requerido',
  PAYMENT_UNSUCCESSFUL: 'El pago no ha sido exitoso',

  // Referrals / Affiliates
  REFERRAL_NOT_FOUND: 'Referido no encontrado',
  REFERRAL_CODE_REQUIRED: 'El código de referido es requerido',
  REFERRAL_CODE_INVALID: 'Código de referido inválido o expirado',
  REFERRAL_CODE_GENERATION_FAILED: 'Error al generar un código de referido único',
  REFERRAL_CODE_ALREADY_ACTIVE: 'El usuario ya tiene un código de referido activo',
  AFFILIATE_PROFILE_NOT_FOUND: 'Perfil de afiliado no encontrado',
  AFFILIATE_PROFILE_EXISTS: 'El perfil de afiliado ya existe',

  // API Keys / Integrations
  API_KEY_NOT_FOUND: 'Clave API no encontrada o no pertenece al usuario',

  // Onboarding
  ONBOARDING_NOT_FOUND: 'Incorporación no encontrada',
  ONBOARDING_ALREADY_COMPLETED: 'La incorporación ya está completada',
  ONBOARDING_NOT_PAUSED: 'La incorporación no está pausada',
  ONBOARDING_RATE_LIMITED: 'Demasiados intentos de completar la incorporación. Por favor, intenta de nuevo más tarde.',
  CHECKLIST_ITEM_NOT_FOUND: 'Elemento de la lista de verificación no encontrado',

  // Skill Tests
  SKILL_TEST_NOT_FOUND: 'Prueba de habilidad no encontrada',
  TEST_ATTEMPT_NOT_FOUND: 'Intento de prueba no encontrado',
  TEST_ATTEMPT_IN_PROGRESS: 'Ya hay un intento de prueba en curso',
  TEST_ATTEMPT_NOT_IN_PROGRESS: 'El intento de prueba no está en curso',
  TEST_ANSWERS_REQUIRED: 'Las respuestas son requeridas',

  // Sessions / Outcomes
  SESSION_NOT_FOUND: 'Sesión no encontrada',
  SESSION_OUTCOME_NOT_FOUND: 'Resultado de la sesión no encontrado',
  SESSION_OUTCOME_INVALID_STATE: 'Solo se pueden crear resultados para sesiones completadas',
  SESSION_MILESTONE_LINK_MISSING: 'La sesión no está vinculada a ningún hito',
  SESSION_MILESTONE_ALREADY_LINKED: 'La sesión ya está vinculada a un hito',
  SESSION_NOT_AUTHORIZED: 'No autorizado para esta sesión',

  // Background Checks
  BACKGROUND_CHECK_NOT_FOUND: 'Verificación de antecedentes no encontrada',
  BACKGROUND_CHECK_ALREADY_IN_PROGRESS: 'La verificación de antecedentes ya está en curso',
  BACKGROUND_CHECK_SIMULATION_DISABLED: 'Las verificaciones de antecedentes simuladas están deshabilitadas en producción',
  BACKGROUND_CHECK_INPUT_REQUIRED: 'El tipo de verificación y el proveedor son requeridos',

  // Bulk / CSV
  BULK_CSV_VALIDATION_FAILED: 'Error de validación del CSV',
  BULK_CSV_COLUMN_MISSING: 'Falta la columna requerida en el CSV: {{column}}',

  // Oracle / iCal / MFA / Misc domain
  ORACLE_NOT_CONFIGURED: 'El contrato de Oracle no está configurado',
  ICAL_TOKEN_INVALID: 'Token de calendario inválido o expirado',
  ICAL_RATE_LIMIT_EXCEEDED: 'Límite de solicitudes excedido para el feed de calendario',
  MFA_PHONE_NUMBER_REQUIRED: 'Número de teléfono requerido para MFA por SMS',
  INVALID_CURSOR: 'Cursor de paginación inválido',
  ASSET_UNSUPPORTED: 'Activo no soportado',
  SDEX_LIQUIDITY_UNAVAILABLE: 'No se encontró liquidez en SDEX para el par solicitado',
  PAYOUT_MINIMUM_NOT_MET: 'El monto mínimo de pago no se alcanza',
  GOAL_NOT_FOUND: 'Objetivo no encontrado',
  GOAL_UPDATE_FAILED: 'Error al actualizar el objetivo',
  WEBHOOK_PAYLOAD_INVALID: 'Falta la referencia del proveedor en el payload del webhook',
  SUBMISSION_NOT_FOUND: 'Entrega no encontrada',
  SUBMISSION_ANSWERS_REQUIRED: 'El texto de respuesta es requerido',
};

// ---------------------------------------------------------------------------
// 5. Hardcoded French translations for ALL error codes
// ---------------------------------------------------------------------------
const FR_TRANSLATIONS = {
  // Authentication
  AUTH_UNAUTHORIZED: 'Accès non autorisé',
  AUTH_AUTHENTICATION_REQUIRED: 'Authentification requise',
  AUTH_INVALID_CREDENTIALS: 'Email ou mot de passe invalide',
  AUTH_EMAIL_ALREADY_REGISTERED: "L'adresse email est déjà enregistrée",
  AUTH_TOKEN_EXPIRED: 'Session expirée. Veuillez vous reconnecter',
  AUTH_TOKEN_INVALID: 'Token de session invalide',
  AUTH_REFRESH_TOKEN_INVALID: 'Token de rafraîchissement invalide ou expiré',
  AUTH_ACCOUNT_BANNED: 'Votre compte a été banni définitivement. Veuillez contacter le support si vous pensez qu\'il s\'agit d\'une erreur.',
  AUTH_ACCOUNT_SUSPENDED: 'Votre compte a été suspendu. Veuillez contacter le support pour plus d\'informations.',
  AUTH_ACCOUNT_INACTIVE: 'Le compte n\'est pas actif',
  AUTH_ACCOUNT_LOCKED: 'Le compte a été verrouillé',
  AUTH_EMAIL_NOT_VERIFIED: 'Adresse email non vérifiée',
  AUTH_MFA_REQUIRED: 'Authentification à deux facteurs requise',
  AUTH_MFA_INVALID: 'Code de vérification invalide',
  AUTH_MFA_TOKEN_INVALID: 'Token MFA invalide ou expiré',
  AUTH_INVALID_RESET_TOKEN: 'Token de réinitialisation invalide ou expiré',
  AUTH_PASSWORD_MISMATCH: 'Les mots de passe ne correspondent pas',
  AUTH_WEAK_PASSWORD: 'Le mot de passe est trop faible',

  // Authorization
  AUTHZ_FORBIDDEN: 'Accès refusé',
  AUTHZ_ACCESS_DENIED: "Vous n'avez pas accès à cette ressource",
  AUTHZ_INSUFFICIENT_PERMISSIONS: "Vous n'avez pas la permission d'effectuer cette action",
  AUTHZ_ADMIN_ONLY: 'Cette action nécessite des privilèges administrateur',
  AUTHZ_RESOURCE_OWNERSHIP_REQUIRED: "Seul le propriétaire de la ressource peut effectuer cette action",

  // Bookings
  BOOKING_CONFLICT: 'Le mentor n\'est pas disponible à l\'heure demandée',
  BOOKING_NOT_FOUND: 'Réservation non trouvée',
  BOOKING_MENTEE_NOT_FOUND: 'Mentoré non trouvé',
  BOOKING_MENTOR_NOT_FOUND: 'Mentor non trouvé',
  BOOKING_USER_SUSPENDED: 'Votre compte est suspendu. Vous ne pouvez pas créer de réservations pour le moment.',
  BOOKING_USER_BANNED: 'Votre compte a été banni définitivement.',
  BOOKING_USER_NOT_A_MENTOR: "L'utilisateur n'est pas un mentor",
  BOOKING_MENTOR_PROFILE_NOT_FOUND: 'Profil du mentor ou tarif horaire non trouvés',
  BOOKING_HOURLY_RATE_NOT_SET: 'Profil du mentor ou tarif horaire non trouvés',
  BOOKING_INVALID_STATUS: 'Impossible de modifier la réservation dans l\'état actuel',
  BOOKING_ONLY_MENTEE_CAN_UPDATE: 'Seul le mentoré peut modifier les détails de la réservation',
  BOOKING_ONLY_MENTOR_CAN_CONFIRM: 'Seul le mentor peut confirmer les réservations',
  BOOKING_NOT_PENDING: 'La réservation n\'est pas en attente',
  BOOKING_PAYMENT_REQUIRED_BEFORE_CONFIRMATION: 'Le paiement doit être effectué avant la confirmation',
  BOOKING_NOT_CONFIRMED: 'Seules les réservations confirmées peuvent être terminées',
  BOOKING_SESSION_NOT_ENDED: 'Impossible de terminer la réservation avant la fin de la session',
  BOOKING_ALREADY_CANCELLED: 'Impossible d\'annuler la réservation dans l\'état actuel',
  BOOKING_RESCHEDULE_NOT_ALLOWED: 'Impossible de reprogrammer la réservation dans l\'état actuel',
  BOOKING_UPDATE_FAILED: 'Échec de la mise à jour de la réservation',
  BOOKING_CONFIRM_FAILED: 'Échec de la confirmation de la réservation',
  BOOKING_COMPLETION_FAILED: 'Échec de la finalisation de la réservation',
  BOOKING_CANCELLATION_FAILED: 'Échec de l\'annulation de la réservation',
  BOOKING_RESCHEDULE_FAILED: 'Échec de la reprogrammation de la réservation',

  // Payments
  PAYMENT_BOOKING_NOT_FOUND: 'Réservation non trouvée',
  PAYMENT_ACCESS_DENIED: 'Accès refusé',
  PAYMENT_ALREADY_COMPLETED: 'La réservation est déjà payée',
  PAYMENT_ALREADY_CONFIRMED: 'Paiement déjà confirmé',
  PAYMENT_ALREADY_REFUNDED: 'Paiement déjà remboursé',
  PAYMENT_NOT_FOUND: 'Paiement non trouvé',
  PAYMENT_INVALID_STATUS: 'Le paiement ne peut pas être traité dans son état actuel',
  PAYMENT_REFUND_NOT_ALLOWED: 'Seuls les paiements complétés peuvent être remboursés',
  PAYMENT_UNSUPPORTED_CURRENCY: 'Devise non supportée',
  PAYMENT_INVALID_TX_HASH: 'Format de hash de transaction Stellar invalide',
  PAYMENT_TX_VERIFICATION_FAILED: 'Impossible de vérifier la transaction sur le réseau Stellar',
  PAYMENT_TX_TOO_OLD: 'La transaction est trop ancienne pour être confirmée (doit être dans les 24 heures)',
  PAYMENT_TX_NOT_SUCCESSFUL: 'La transaction Stellar n\'a pas été réussie',
  PAYMENT_SOURCE_ACCOUNT_MISMATCH: 'Le compte source de la transaction ne correspond pas à l\'expéditeur du paiement',
  PAYMENT_NO_MATCHING_OPERATION: 'La transaction ne contient pas d\'opération de paiement correspondante',
  PAYMENT_CONFIRM_FAILED: 'Échec de la confirmation du paiement',
  PAYMENT_QUOTE_EXPIRED: 'Le devis a expiré ou est invalide',

  // Escrow
  ESCROW_NOT_FOUND: 'Séquestre non trouvé',
  ESCROW_CREATION_FAILED: 'Échec de la création du séquestre',
  ESCROW_RELEASE_FAILED: 'Échec de la libération des fonds du séquestre',
  ESCROW_REFUND_FAILED: 'Échec du remboursement des fonds du séquestre',
  ESCROW_ALREADY_RELEASED: 'Les fonds du séquestre ont déjà été libérés',
  ESCROW_DISPUTE_RESOLUTION_FAILED: 'Échec de la résolution du litige du séquestre',
  ESCROW_METADATA_MISSING: 'Aucune métadonnée de séquestre trouvée sur la réservation',

  // Disputes
  DISPUTE_SESSION_NOT_FOUND: 'Session non trouvée',
  DISPUTE_NOT_FOUND: 'Litige non trouvé',
  DISPUTE_CREATION_FAILED: 'Échec de la création du litige',
  DISPUTE_UNAUTHORIZED: 'Non autorisé : Vous n\'êtes pas partie à ce litige',
  DISPUTE_ESCROW_MISSING: 'Aucun séquestre trouvé pour la réservation',
  DISPUTE_INVALID_STATUS_TRANSITION: 'Le litige ne peut pas passer à l\'état demandé',
  DISPUTE_UPDATE_FAILED: 'Échec de la mise à jour de l\'état du litige',

  // Users
  USER_NOT_FOUND: 'Utilisateur non trouvé',
  USER_ACCESS_DENIED: 'Accès refusé',
  USER_UPDATE_FAILED: 'Échec de la mise à jour de l\'utilisateur',
  USER_PROFILE_INCOMPLETE: 'Le profil utilisateur est incomplet',
  USER_DEACTIVATION_FAILED: 'Échec de la désactivation du compte',
  USER_PII_ENCRYPTION_FAILED: 'Échec du chiffrement des données personnelles',

  // Mentors
  MENTOR_NOT_FOUND: 'Mentor non trouvé',
  MENTOR_NOT_AVAILABLE: 'Ce mentor n\'est pas disponible pour les réservations actuellement',
  MENTOR_PROFILE_UPDATE_FAILED: 'Échec de la mise à jour du profil du mentor',
  MENTOR_VERIFICATION_PENDING: 'La vérification du mentor est en attente de révision',
  MENTOR_INVALID_GROUP_BY: 'Valeur groupBy invalide',

  // Validation
  VALIDATION_ERROR: 'Échec de la validation',
  VALIDATION_REQUIRED_FIELD: '{{field}} est requis',
  VALIDATION_INVALID_FORMAT: '{{field}} a un format invalide',
  VALIDATION_OUT_OF_RANGE: '{{field}} est hors de portée',
  VALIDATION_PROGRESS_OUT_OF_RANGE: 'La progression doit être un nombre entre 0 et 100',
  VALIDATION_INVALID_TIMEFRAME: 'Période invalide. Doit être l\'une des : week, month, quarter, year, all',
  VALIDATION_MISSING_QUERY_PARAMS: 'Paramètres de requête requis manquants',
  VALIDATION_MISSING_OAUTH_STATE: 'Code ou état OAuth manquant',
  VALIDATION_INVALID_OAUTH_STATE: 'Format d\'état OAuth invalide',

  // OAuth / Integrations
  OAUTH_GOOGLE_ERROR: 'L\'autorisation Google OAuth a échoué',
  OAUTH_CSRF_TOKEN_INVALID: 'Token CSRF invalide ou expiré',
  INTEGRATION_JOB_NOT_FOUND: 'Tâche non trouvée',
  ZAPIER_SCOPE_MISSING: 'Portée requise manquante dans la clé API',

  // Uploads / Attachments
  UPLOAD_FAILED: 'Échec du téléchargement du fichier',
  UPLOAD_FILE_TOO_LARGE: 'Fichier trop volumineux',
  UPLOAD_INVALID_TYPE: 'Type de fichier invalide',
  UPLOAD_QUOTA_EXCEEDED: 'Quota de téléchargement quotidien dépassé',

  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'Vous avez dépassé la limite de débit',

  // Infrastructure / Generic
  BAD_REQUEST: 'Mauvaise requête',
  NOT_FOUND: 'Ressource non trouvée',
  CONFLICT: 'Conflit de ressource',
  INTERNAL_SERVER_ERROR: 'Erreur interne du serveur',
  SERVICE_UNAVAILABLE: 'Service temporairement indisponible',
  CIRCUIT_BREAKER_OPEN: 'Le disjoncteur de la base de données est ouvert',
  DATABASE_CONNECTION_FAILED: 'Échec de la connexion à la base de données',
  DATABASE_QUERY_TIMEOUT: 'La requête de la base de données a expiré',
  DATABASE_UNIQUE_VIOLATION: 'Un enregistrement avec ces détails existe déjà',
  DATABASE_FOREIGN_KEY_VIOLATION: 'L\'enregistrement référencé n\'existe pas',
  RESOURCE_NOT_FOUND: 'Ressource non trouvée',
  DUPLICATE_REQUEST: 'Requête en double',
  MAINTENANCE_MODE: 'Système en maintenance',

  // Learning Paths
  LEARNING_PATH_NOT_FOUND: 'Parcours d\'apprentissage non trouvé',
  LEARNING_PATH_NOT_PUBLISHED: 'Le parcours d\'apprentissage n\'est pas publié',
  LEARNING_PATH_ALREADY_PUBLISHED: 'Le parcours d\'apprentissage est déjà publié',
  LEARNING_PATH_HAS_ACTIVE_ENROLLMENTS: 'Impossible de modifier le parcours d\'apprentissage avec des inscriptions actives',
  LEARNING_PATH_NO_MILESTONES: 'Le parcours d\'apprentissage doit avoir au moins un jalon pour être publié',
  LEARNING_PATH_CLONING_NOT_ALLOWED: 'Le parcours n\'est pas disponible pour le clonage',
  LEARNING_PATH_TEMPLATE_NOT_FOUND: 'Parcours modèle non trouvé',
  LEARNING_PATH_UPDATE_FAILED: 'Échec de la mise à jour du parcours d\'apprentissage',
  LEARNING_PATH_DELETE_FAILED: 'Échec de la suppression du parcours d\'apprentissage',
  LEARNING_PATH_PUBLISH_FAILED: 'Échec de la publication du parcours d\'apprentissage',
  LEARNING_PATH_UNPUBLISH_FAILED: 'Échec de la dépublication du parcours d\'apprentissage',
  LEARNING_PATH_NOT_ENROLLED: 'Non inscrit à ce parcours d\'apprentissage',
  LEARNING_PATH_NOT_COMPLETED: 'Le parcours d\'apprentissage n\'est pas terminé ou l\'inscription non trouvée',
  PATH_ID_REQUIRED: 'L\'ID du parcours est requis',
  MILESTONE_ID_REQUIRED: 'L\'ID du jalon est requis',

  // Enrollment
  ENROLLMENT_NOT_FOUND: 'Inscription non trouvée',
  ENROLLMENT_ALREADY_EXISTS: 'L\'étudiant est déjà inscrit à ce parcours d\'apprentissage',
  ENROLLMENT_ALREADY_UNENROLLED: 'L\'étudiant est déjà désinscrit',
  ENROLLMENT_STATUS_TRANSITION_INVALID: 'La transition de l\'état d\'inscription n\'est pas autorisée',
  ENROLLMENT_UPDATE_FAILED: 'Échec de la mise à jour de l\'état d\'inscription',
  STUDENT_NOT_FOUND: 'Étudiant non trouvé',
  STUDENT_ACCOUNT_INACTIVE: 'Le compte de l\'étudiant n\'est pas actif',
  ENROLLMENT_ACCESS_DENIED: 'Accès refusé à cette inscription',

  // Milestones
  MILESTONE_NOT_FOUND: 'Jalon non trouvé',
  MILESTONE_ALREADY_COMPLETED: 'Le jalon est déjà terminé',
  MILESTONE_COMPLETION_FAILED: 'Échec de la finalisation du jalon',
  MILESTONE_PREREQUISITES_NOT_MET: 'Les prérequis ne sont pas remplis pour ce jalon',
  MILESTONE_STEP_PREREQUISITES_NOT_MET: 'Les prérequis de l\'étape ne sont pas remplis',
  MILESTONE_STEP_INVALID: 'ID d\'étape invalide',
  MILESTONE_ACCESS_DENIED: 'Accès refusé à ce jalon',
  PREREQUISITE_NOT_FOUND: 'Prérequis non trouvé',
  PREREQUISITE_OVERRIDE_NOT_FOUND: 'Exception non trouvée',
  PREREQUISITE_OVERRIDE_EXISTS: 'Une exception existe déjà pour ce prérequis',
  PREREQUISITE_OVERRIDE_PERMISSION_DENIED: 'Seul le mentor peut gérer les exceptions de prérequis',

  // Certifications / Certificates
  CERTIFICATION_TYPE_NOT_FOUND: 'Type de certification non trouvé',
  CERTIFICATION_NOT_FOUND: 'Certification non trouvée',
  CERTIFICATION_ALREADY_EXISTS: 'Une certification existe déjà pour ce mentor',
  CERTIFICATE_NOT_FOUND: 'Certificat non trouvé',
  CERTIFICATE_ALREADY_EXISTS: 'Le certificat existe déjà',
  CERTIFICATE_REVOKE_PERMISSION_DENIED: 'Permissions insuffisantes pour révoquer le certificat',
  CERTIFICATE_MILESTONES_INCOMPLETE: 'Tous les jalons doivent être terminés avant de générer le certificat',

  // Reviews
  REVIEW_NOT_FOUND: 'Avis non trouvé',
  REVIEW_ALREADY_EXISTS: 'L\'avis existe déjà',
  REVIEW_VOTE_DUPLICATE: 'Vous avez déjà voté pour cet avis',
  REVIEW_FLAG_DUPLICATE: 'Vous avez déjà signalé cet avis',
  REVIEW_SELF_INTERACTION_FORBIDDEN: 'Vous ne pouvez pas interagir avec votre propre avis',
  REVIEW_RESPONSE_NOT_FOUND: 'Réponse à l\'avis non trouvée',
  REVIEW_RESPONSE_CREATE_FAILED: 'Échec de la création de la réponse à l\'avis',
  REVIEW_EDIT_FORBIDDEN: 'Vous n\'êtes pas autorisé à modifier cet avis',
  REVIEW_DELETE_FORBIDDEN: 'Vous n\'êtes pas autorisé à supprimer cet avis',
  SELF_REVIEW_FORBIDDEN: 'Vous ne pouvez pas évaluer votre propre soumission',

  // Study Groups / Forums
  STUDY_GROUP_NOT_FOUND: 'Groupe d\'étude non trouvé ou accès refusé',
  STUDY_GROUP_FULL: 'Le groupe d\'étude est complet',
  STUDY_GROUP_MEMBER_EXISTS: 'L\'utilisateur est déjà membre de ce groupe d\'étude',
  STUDY_GROUP_ENROLLMENT_REQUIRED: 'Vous devez être inscrit au parcours d\'apprentissage pour rejoindre le groupe d\'étude',
  FORUM_NOT_FOUND: 'Forum non trouvé ou accès refusé',
  FORUM_ALREADY_EXISTS: 'Un forum existe déjà pour ce jalon',
  FORUM_POST_DENIED: 'Accès refusé pour publier dans ce forum',

  // Payments (learning-path purchases, etc.)
  PAYMENT_REFERENCE_ALREADY_USED: 'La référence de paiement a déjà été utilisée',
  PAYMENT_INSUFFICIENT_AMOUNT: 'Le montant du paiement est insuffisant',
  PAYMENT_CURRENCY_MISMATCH: 'La devise du paiement ne correspond pas à la devise attendue',
  PAYMENT_REQUIRED: 'Paiement requis',
  PAYMENT_UNSUCCESSFUL: 'Le paiement n\'a pas réussi',

  // Referrals / Affiliates
  REFERRAL_NOT_FOUND: 'Parrainage non trouvé',
  REFERRAL_CODE_REQUIRED: 'Le code de parrainage est requis',
  REFERRAL_CODE_INVALID: 'Code de parrainage invalide ou expiré',
  REFERRAL_CODE_GENERATION_FAILED: 'Échec de la génération d\'un code de parrainage unique',
  REFERRAL_CODE_ALREADY_ACTIVE: 'L\'utilisateur a déjà un code de parrainage actif',
  AFFILIATE_PROFILE_NOT_FOUND: 'Profil d\'affilié non trouvé',
  AFFILIATE_PROFILE_EXISTS: 'Le profil d\'affilié existe déjà',

  // API Keys / Integrations
  API_KEY_NOT_FOUND: 'Clé API non trouvée ou n\'appartient pas à l\'utilisateur',

  // Onboarding
  ONBOARDING_NOT_FOUND: 'Intégration non trouvée',
  ONBOARDING_ALREADY_COMPLETED: 'L\'intégration est déjà terminée',
  ONBOARDING_NOT_PAUSED: 'L\'intégration n\'est pas en pause',
  ONBOARDING_RATE_LIMITED: 'Trop de tentatives de finalisation de l\'intégration. Veuillez réessayer plus tard.',
  CHECKLIST_ITEM_NOT_FOUND: 'Élément de la liste de contrôle non trouvé',

  // Skill Tests
  SKILL_TEST_NOT_FOUND: 'Test de compétence non trouvé',
  TEST_ATTEMPT_NOT_FOUND: 'Tentative de test non trouvée',
  TEST_ATTEMPT_IN_PROGRESS: 'Une tentative de test est déjà en cours',
  TEST_ATTEMPT_NOT_IN_PROGRESS: 'La tentative de test n\'est pas en cours',
  TEST_ANSWERS_REQUIRED: 'Les réponses sont requises',

  // Sessions / Outcomes
  SESSION_NOT_FOUND: 'Session non trouvée',
  SESSION_OUTCOME_NOT_FOUND: 'Résultat de la session non trouvé',
  SESSION_OUTCOME_INVALID_STATE: 'Les résultats ne peuvent être créés que pour les sessions terminées',
  SESSION_MILESTONE_LINK_MISSING: 'La session n\'est liée à aucun jalon',
  SESSION_MILESTONE_ALREADY_LINKED: 'La session est déjà liée à un jalon',
  SESSION_NOT_AUTHORIZED: 'Non autorisé pour cette session',

  // Background Checks
  BACKGROUND_CHECK_NOT_FOUND: 'Vérification des antécédents non trouvée',
  BACKGROUND_CHECK_ALREADY_IN_PROGRESS: 'La vérification des antécédents est déjà en cours',
  BACKGROUND_CHECK_SIMULATION_DISABLED: 'Les vérifications des antécédents simulées sont désactivées en production',
  BACKGROUND_CHECK_INPUT_REQUIRED: 'Le type de vérification et le fournisseur sont requis',

  // Bulk / CSV
  BULK_CSV_VALIDATION_FAILED: 'Échec de la validation du CSV',
  BULK_CSV_COLUMN_MISSING: 'Colonne requise manquante dans le CSV : {{column}}',

  // Oracle / iCal / MFA / Misc domain
  ORACLE_NOT_CONFIGURED: 'Le contrat Oracle n\'est pas configuré',
  ICAL_TOKEN_INVALID: 'Token de calendrier invalide ou expiré',
  ICAL_RATE_LIMIT_EXCEEDED: 'Limite de débit dépassée pour le flux calendrier',
  MFA_PHONE_NUMBER_REQUIRED: 'Numéro de téléphone requis pour le MFA par SMS',
  INVALID_CURSOR: 'Curseur de pagination invalide',
  ASSET_UNSUPPORTED: 'Actif non supporté',
  SDEX_LIQUIDITY_UNAVAILABLE: 'Aucune liquidité trouvée sur SDEX pour la paire demandée',
  PAYOUT_MINIMUM_NOT_MET: 'Le montant minimum de paiement n\'est pas atteint',
  GOAL_NOT_FOUND: 'Objectif non trouvé',
  GOAL_UPDATE_FAILED: 'Échec de la mise à jour de l\'objectif',
  WEBHOOK_PAYLOAD_INVALID: 'Référence du fournisseur manquante dans le payload du webhook',
  SUBMISSION_NOT_FOUND: 'Soumission non trouvée',
  SUBMISSION_ANSWERS_REQUIRED: 'Le texte de la réponse est requis',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const src = fs.readFileSync(ERROR_CODES_PATH, 'utf8');

  const enumValues = extractEnumValues(src);
  const catalogMessages = extractCatalogMessages(src);

  console.log(`Extracted ${enumValues.length} error codes from error-codes.ts`);
  console.log(`Extracted ${Object.keys(catalogMessages).length} catalog messages`);

  const filesUpdated = [];

  // English: use catalog messages directly
  const enData = readLocaleErrors('en');
  enData.codes = {};
  for (const code of enumValues) {
    enData.codes[code] = catalogMessages[code] || code;
  }
  const enPath = writeLocaleErrors('en', enData);
  filesUpdated.push({ locale: 'en', path: enPath, count: enumValues.length });

  // Spanish
  const esData = readLocaleErrors('es');
  esData.codes = {};
  for (const code of enumValues) {
    esData.codes[code] = ES_TRANSLATIONS[code] || catalogMessages[code] || code;
  }
  const esPath = writeLocaleErrors('es', esData);
  filesUpdated.push({ locale: 'es', path: esPath, count: enumValues.length });

  // French
  const frData = readLocaleErrors('fr');
  frData.codes = {};
  for (const code of enumValues) {
    frData.codes[code] = FR_TRANSLATIONS[code] || catalogMessages[code] || code;
  }
  const frPath = writeLocaleErrors('fr', frData);
  filesUpdated.push({ locale: 'fr', path: frPath, count: enumValues.length });

  // Report
  console.log('\n--- Files updated ---');
  for (const f of filesUpdated) {
    console.log(`  ${f.locale}: ${f.path} (${f.count} codes)`);
  }
  console.log(`\nDone. ${filesUpdated.length} files updated.`);
}

main();
