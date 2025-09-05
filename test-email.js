const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'pearlassist4@gmail.com',
        pass: 'axul tbvb hpjo ipkj'
    },
    logger: true,
    debug: true
});

async function testEmail() {
    try {
        const info = await transporter.sendMail({
            from: '"PearlAssist Test" <pearlassist4@gmail.com>',
            to: 'pearlassist4@gmail.com', // Testez d'abord vers vous-même
            subject: 'Test SMTP PearlAssist',
            text: 'Ceci est un email de test',
            html: '<b>Ceci est un email de test HTML</b>'
        });

        console.log('Email envoyé:', info.messageId);
    } catch (error) {
        console.error('Erreur d\'envoi:', error);
    }
}

testEmail();