import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    console.log(`[Mailer] Initialized SMTP transporter via ${host}:${port}`);
  } else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
    console.log('[Mailer] Initialized Gmail transporter');
  }

  return transporter;
}

/**
 * Sends official Enquiry Welcome Notice email
 * Matching authentic GAS template from D:\prime\enquiry forum\code.gs
 */
export async function sendEnquiryWelcomeEmail(toEmail, studentName) {
  if (!toEmail || !toEmail.includes('@')) {
    return { sent: false, skipped: true, reason: 'Invalid or missing email' };
  }

  const emailBody = [
    'WELCOME NOTICE',
    '',
    'प्रिय अभिभावकों,',
    '',
    'हमारे संस्थान THE PRIME CLASSES में पधारने के लिए आपका हार्दिक धन्यवाद।',
    'आपका विश्वास और सहयोग हमारे लिए अत्यंत महत्वपूर्ण है।',
    '',
    'हम सदैव विद्यार्थियों के उज्ज्वल भविष्य, अनुशासन, गुणवत्ता पूर्ण शिक्षा एवं श्रेष्ठ मार्गदर्शन के लिए समर्पित हैं।',
    'हमें प्रसन्नता है कि आपने अपने बच्चे के भविष्य के लिए हमारे संस्थान को समय दिया।',
    '',
    'हम आशा करते हैं कि आपको हमारी शिक्षण व्यवस्था, वातावरण एवं मार्गदर्शन पसंद आया होगा।',
    'यदि आपके कोई प्रश्न या सुझाव हों, तो कृपया हमसे अवश्य साझा करें।',
    '',
    '✨ “आपका विश्वास ही हमारी सबसे बड़ी प्रेरणा है।”',
    '',
    '📞 किसी भी प्रकार की जानकारी, सहायता या मार्गदर्शन के लिए आप दिए गए नंबर पर हमसे कभी भी संपर्क कर सकते हैं।',
    '',
    '📞 9009897972',
    '📞 7879979278',
    '',
    'सादर,',
    'Team – The Prime Classes',
    '(RMS | Sainik School | RIMC)',
    '',
    'AH-26, Near Laxmi Vatika,',
    'Gate No. 1, D.D. Nagar,',
    'Gwalior (M.P.)'
  ].join('\n');

  const client = getTransporter();
  if (!client) {
    console.log(`[Mailer:Simulated] Enquiry welcome mail simulated for: ${toEmail} (student: ${studentName || 'Student'})`);
    return { sent: true, simulated: true, message: 'Email logged (SMTP not configured)' };
  }

  try {
    const info = await client.sendMail({
      from: `"The Prime Classes" <${process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER || 'admissions@theprimeclasses.com'}>`,
      to: toEmail,
      subject: 'Welcome to The Prime Classes 🌻',
      text: emailBody
    });
    console.log(`[Mailer] Welcome email delivered to ${toEmail}: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Mailer] Failed sending welcome email to ${toEmail}:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Sends official Admission Confirmation Notice email
 * Matching authentic GAS template from D:\prime\admission forum prime\code.gs
 */
export async function sendAdmissionConfirmationEmail(toEmail, admissionContext = {}) {
  const { studentName, studentId, className, program } = admissionContext;

  if (!toEmail || !toEmail.includes('@')) {
    return { sent: false, skipped: true, reason: 'Invalid or missing email' };
  }

  const emailBody = [
    'ADMISSION CONFIRMATION NOTICE',
    '',
    'प्रिय अभिभावकों,',
    '',
    'THE PRIME CLASSES परिवार में आपका हार्दिक स्वागत है।',
    'अपने बच्चे के उज्ज्वल भविष्य के लिए हमारे संस्थान पर विश्वास करने हेतु आपका धन्यवाद।',
    '',
    `विद्यार्थी का नाम: ${studentName || 'Student'}`,
    studentId ? `विद्यार्थी आईडी: ${studentId}` : '',
    className ? `कक्षा / वर्ग: ${className}` : '',
    program ? `प्रोग्राम: ${program}` : '',
    '',
    'हम आपको विश्वास दिलाते हैं कि आपके बच्चे को यहाँ गुणवत्तापूर्ण शिक्षा, अनुशासित वातावरण एवं श्रेष्ठ मार्गदर्शन प्रदान किया जाएगा।',
    'हमारा उद्देश्य केवल परीक्षा की तैयारी कराना नहीं, बल्कि विद्यार्थियों में आत्मविश्वास, नेतृत्व क्षमता एवं राष्ट्र सेवा की भावना विकसित करना है।',
    '',
    'आपके सहयोग और विश्वास के साथ हम आपके बच्चे को सफलता की नई ऊँचाइयों तक पहुँचाने के लिए पूर्ण रूप से समर्पित हैं।',
    '',
    '✨ “आज लिया गया सही निर्णय, आपके बच्चे का सुनहरा भविष्य बनाएगा।”',
    '',
    '📞 किसी भी प्रकार की जानकारी, सहायता या मार्गदर्शन के लिए आप दिए गए नंबर पर हमसे कभी भी संपर्क कर सकते हैं।',
    '',
    '📞 9009897972',
    '📞 7879979278',
    '',
    'सादर,',
    'Team – The Prime Classes',
    '(RMS | Sainik School | RIMC)',
    '',
    'AH-26, Near Laxmi Vatika,',
    'Gate No. 1, D.D. Nagar,',
    'Gwalior (M.P.)'
  ].filter(Boolean).join('\n');

  const client = getTransporter();
  if (!client) {
    console.log(`[Mailer:Simulated] Admission confirmation mail simulated for: ${toEmail} (${studentId || ''} - ${studentName || 'Student'})`);
    return { sent: true, simulated: true, message: 'Email logged (SMTP not configured)' };
  }

  try {
    const info = await client.sendMail({
      from: `"The Prime Classes" <${process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER || 'admissions@theprimeclasses.com'}>`,
      to: toEmail,
      subject: `Admission Confirmed – The Prime Classes 🌸${studentId ? ` [${studentId}]` : ''}`,
      text: emailBody
    });
    console.log(`[Mailer] Admission confirmation delivered to ${toEmail}: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Mailer] Failed sending confirmation email to ${toEmail}:`, err.message);
    return { sent: false, error: err.message };
  }
}
