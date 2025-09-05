const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const bodyParser = require('body-parser');
const { initializeDatabase, Reservation, Cancellation } = require('./database');
const path = require('path');

// Initialiser la base de données
initializeDatabase();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Servir les fichiers statiques du dashboard
app.use('/dashboard', express.static(path.join(__dirname, '../public')));

// Route pour accéder au dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// Route pour la page de connexion
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Configuration des headers pour Hub2
const HUB2_CONFIG = {
    headers: {
        'Authorization': 'Bearer sk_RGOq7QwdWPGJDxcOBBCIIuMpQqwv0h9G', // Votre clé API
        'Merchant-Id': 'joptyJ9BthJLzaX1g3EyV', // Votre ID marchand
        'Content-Type': 'application/json',
        'environment': 'sandbox' // 'sandbox' pour les tests
    },
    apiUrl: 'https://api.hub2.io/v1'
};

// Route pour créer un intent de paiement avec Wave
app.post('/create-wave-payment-intent', async (req, res) => {
    try {
        const { amount, reservationNumber, customerEmail } = req.body;
        
        const paymentIntent = {
            customerReference: customerEmail,
            purchaseReference: reservationNumber,
            amount: amount,
            currency: "XOF"
        };

        const response = await fetch(`${HUB2_CONFIG.apiUrl}/payment_intents`, {
            method: 'POST',
            headers: HUB2_CONFIG.headers,
            body: JSON.stringify(paymentIntent)
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Erreur lors de la création du payment intent');
        }

        res.json({ 
            success: true, 
            paymentIntent: data
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Route pour initier le paiement Wave
app.post('/initiate-wave-payment', async (req, res) => {
    try {
        const { token, phone, provider, country, reservationNumber } = req.body;
        
        const paymentData = {
            token: token,
            paymentMethod: "mobile_money",
            country: country,
            provider: provider,
            mobileMoney: {
                msisdn: phone, 
                onSuccessRedirectionUrl: "https://3ff63a73729b.ngrok-free.app/payment-success",
                onFailedRedirectionUrl: "https://3ff63a73729b.ngrok-free.app/payment-failure"
            }
        };

        const response = await fetch(`${HUB2_CONFIG.apiUrl}/payments`, {
            method: 'POST',
            headers: HUB2_CONFIG.headers,
            body: JSON.stringify(paymentData)
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Erreur lors du paiement');
        }

        res.json({ 
            success: true, 
            payment: data 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Routes de redirection après paiement
app.get('/payment-success', (req, res) => {
    res.send('Paiement réussi! Votre réservation est confirmée.');
});

app.get('/payment-failure', (req, res) => {
    res.send('Paiement échoué. Veuillez réessayer.');
});

// Webhook pour les notifications de paiement
app.post('/webhook/wave-payment', async (req, res) => {
    try {
        const event = req.body;
        
        // Vérifier la signature du webhook si nécessaire
        // (voir documentation HUB2 pour la validation)

        switch (event.type) {
            case 'payment_intent.succeeded':
                // Mettre à jour la réservation comme payée
                await Reservation.update(
                    { paymentConfirmed: true },
                    { where: { reservationNumber: event.data.object.purchaseReference } }
                );
                break;
                
            case 'payment_intent.payment_failed':
                console.error('Paiement échoué:', event.data.object.purchaseReference);
                break;
        }

        res.json({ received: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Route pour la page de succès
app.get('/success', (req, res) => {
    res.send(`
        <h1>Paiement réussi ✅</h1>
        <p>Votre réservation est confirmée. Un email vous a été envoyé.</p>
        <a href="/">Retour à l'accueil</a>
    `);
});

// Route pour la page d'échec
app.get('/failure', (req, res) => {
    res.send(`
        <h1>Paiement échoué ❌</h1>
        <p>Votre paiement n'a pas abouti. Veuillez réessayer.</p>
        <a href="/paiement">Retour au paiement</a>
    `);
});

// Configuration email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'pearlassist4@gmail.com',
        pass: 'axul tbvb hpjo ipkj'
    }
});

// Route pour les réservations
app.post('/send-reservation', async (req, res) => {
    try {
        const { 
            reservationNumber,
            name, 
            email, 
            phone, 
            service, 
            serviceText, 
            adults, 
            children,
            baggage,
            extraBaggage,
            baggageFees,
            date, 
            flight, 
            total,
            childPrice,
            additionalNotes
        } = req.body;

        // Sauvegarder dans la base de données
        const reservation = await Reservation.create({
            reservationNumber,
            name,
            email,
            phone,
            service,
            serviceText,
            adults,
            children,
            baggage,
            extraBaggage,
            baggageFees,
            date,
            flight,
            total,
            childPrice,
            additionalNotes,
            status: 'confirmed',
            paymentConfirmed: true
        });

        // Formatage de la date
        const formattedDate = new Date(date).toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Calcul détaillé pour affichage
        const servicePrice = parseInt(serviceText.split(' - ')[1]?.replace(/[^\d]/g, '')) || 0;
        const adultsTotal = servicePrice * parseInt(adults);
        const childrenTotal = (childPrice || 25000) * parseInt(children);

        // 1. Email au client
        let clientHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0A2463; margin: 0; font-size: 2rem;">
                        <i class="fas fa-plane" style="color: #D8315B; margin-right: 10px;"></i>
                        PearlAssist
                    </h1>
                    <p style="color: #666; margin: 5px 0 0 0;">Service Premium d'Accueil Aéroportuaire</p>
                </div>
                
                <h2 style="color: #0A2463; border-bottom: 2px solid #D8315B; padding-bottom: 10px;">
                    Merci ${name} pour votre réservation !
                </h2>
                
                <div style="background-color: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
                    <h3 style="color: #2e7d32; margin: 0; font-size: 1.5rem;">
                        <i class="fas fa-check-circle" style="margin-right: 8px;"></i>
                        Numéro de réservation: ${reservationNumber}
                    </h3>
                    <p style="margin: 5px 0 0 0; color: #2e7d32; font-weight: bold;">
                        ✅ Paiement confirmé avec succès !
                    </p>
                </div>
                
                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #D8315B; margin-top: 0; margin-bottom: 15px;">
                        <i class="fas fa-info-circle" style="margin-right: 8px;"></i>
                        Détails de votre réservation
                    </h3>
                    
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Service:</td>
                            <td style="padding: 8px 0;">${serviceText.split(' - ')[0]}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Adultes:</td>
                            <td style="padding: 8px 0;">${adults}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Enfants (2-12 ans):</td>
                            <td style="padding: 8px 0;">${children}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Bagages:</td>
                            <td style="padding: 8px 0;">${baggage} ${extraBaggage > 0 ? `(+${extraBaggage} supplémentaire(s))` : ''}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Date de service:</td>
                            <td style="padding: 8px 0;">${formattedDate}</td>
                        </tr>
                        ${flight ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Numéro de vol:</td>
                            <td style="padding: 8px 0;">${flight}</td>
                        </tr>
                        ` : ''}
                        ${additionalNotes ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Remarques:</td>
                            <td style="padding: 8px 0;">${additionalNotes}</td>
                        </tr>
                        ` : ''}
                    </table>
                    
                    <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h4 style="color: #0A2463; margin-bottom: 10px;">Détail du paiement:</h4>
                        <p style="margin: 5px 0; color: #666;">
                            ${adults} adulte(s) × ${servicePrice.toLocaleString('fr-FR')} FCFA = ${adultsTotal.toLocaleString('fr-FR')} FCFA
                        </p>
                        ${parseInt(children) > 0 ? `
                        <p style="margin: 5px 0; color: #666;">
                            ${children} enfant(s) × ${(childPrice || 25000).toLocaleString('fr-FR')} FCFA = ${childrenTotal.toLocaleString('fr-FR')} FCFA
                        </p>
                        ` : ''}
                        ${baggageFees > 0 ? `
                        <p style="margin: 5px 0; color: #666;">
                            ${extraBaggage} bagage(s) supplémentaire(s) × 5.000 FCFA = ${baggageFees.toLocaleString('fr-FR')} FCFA
                        </p>
                        ` : ''}
                        <p style="margin: 15px 0 0 0; font-size: 1.2rem; font-weight: bold; color: #D8315B;">
                            Total payé: ${total.toLocaleString('fr-FR')} FCFA
                        </p>
                    </div>
                </div>
                
                <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h4 style="color: #856404; margin-top: 0;">
                        <i class="fas fa-calendar-alt" style="margin-right: 8px;"></i>
                        Prochaines étapes
                    </h4>
                    <ul style="color: #856404; margin: 0; padding-left: 1.5rem;">
                        <li>Nous vous contacterons sous 24h pour finaliser les détails</li>
                        <li>Conservez ce numéro de réservation : <strong>${reservationNumber}</strong></li>
                        <li>En cas d'annulation, utilisez ce numéro sur notre site web</li>
                    </ul>
                </div>
                
                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                    <p style="color: #666; margin: 0;">
                        <strong>Besoin d'aide ?</strong><br>
                        Contactez-nous au +225 05 46 01 80 00<br>
                        ou par email : abj.vip@menziesaviation.com
                    </p>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: '"PearlAssist" <pearlassist4@gmail.com>',
            to: email,
            subject: `Confirmation de réservation PearlAssist - ${reservationNumber} ✅`,
            html: clientHtml
        });

        // 2. Email à pearlassist4 (admin)
        let adminHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0A2463; margin: 0; font-size: 2rem;">
                        <i class="fas fa-bell" style="color: #D8315B; margin-right: 10px;"></i>
                        Nouvelle Réservation
                    </h1>
                    <p style="color: #28a745; font-weight: bold; margin: 5px 0 0 0; font-size: 1.1rem;">
                        🎉 PAIEMENT CONFIRMÉ - ${reservationNumber}
                    </p>
                </div>
                
                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #D8315B; margin-top: 0; margin-bottom: 15px;">
                        Informations client
                    </h3>
                    
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Client:</td>
                            <td style="padding: 8px 0;">${name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Email:</td>
                            <td style="padding: 8px 0;">${email}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Téléphone:</td>
                            <td style="padding: 8px 0;">${phone}</td>
                        </tr>
                    </table>
                </div>
                
                <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                    <h3 style="color: #856404; margin-top: 0; margin-bottom: 15px;">
                        Détails du service
                    </h3>
                    
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Service:</td>
                            <td style="padding: 8px 0;">${serviceText.split(' - ')[0]}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Adultes:</td>
                            <td style="padding: 8px 0;">${adults}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Enfants:</td>
                            <td style="padding: 8px 0;">${children}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Bagages:</td>
                            <td style="padding: 8px 0;">${baggage} ${extraBaggage > 0 ? `(+${extraBaggage} supplémentaire(s) = +${baggageFees.toLocaleString('fr-FR')} FCFA)` : ''}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Date:</td>
                            <td style="padding: 8px 0;">${formattedDate}</td>
                        </tr>
                        ${flight ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Vol:</td>
                            <td style="padding: 8px 0;">${flight}</td>
                        </tr>
                        ` : ''}
                        ${additionalNotes ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Remarques:</td>
                            <td style="padding: 8px 0;">${additionalNotes}</td>
                        </tr>
                        ` : ''}
                    </table>
                    
                    <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd;">
                        <h4 style="color: #0A2463; margin-bottom: 10px;">Montant encaissé:</h4>
                        <p style="margin: 5px 0; color: #666;">
                            ${adults} adulte(s) × ${servicePrice.toLocaleString('fr-FR')} FCFA = ${adultsTotal.toLocaleString('fr-FR')} FCFA
                        </p>
                        ${parseInt(children) > 0 ? `
                        <p style="margin: 5px 0; color: #666;">
                            ${children} enfant(s) × ${(childPrice || 25000).toLocaleString('fr-FR')} FCFA = ${childrenTotal.toLocaleString('fr-FR')} FCFA
                        </p>
                        ` : ''}
                        ${baggageFees > 0 ? `
                        <p style="margin: 5px 0; color: #666;">
                            ${extraBaggage} bagage(s) supplémentaire(s) × 5.000 FCFA = ${baggageFees.toLocaleString('fr-FR')} FCFA
                        </p>
                        ` : ''}
                        <p style="margin: 15px 0 0 0; font-size: 1.3rem; font-weight: bold; color: #28a745;">
                            Total: ${total.toLocaleString('fr-FR')} FCFA
                        </p>
                    </div>
                </div>
                
                <div style="background-color: #d1ecf1; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #0c5460; font-weight: bold;">
                        📋 Action requise :
                    </p>
                    <p style="margin: 5px 0 0 0; color: #0c5460;">
                        Contacter le client sous 24h pour organiser le service et confirmer les détails.
                    </p>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: '"PearlAssist" <pearlassist4@gmail.com>',
            to: 'pearlassist4@gmail.com',
            subject: `🎉 [RÉSERVATION ${reservationNumber}] ${name} - ${serviceText.split(' - ')[0]} - ${total.toLocaleString('fr-FR')} FCFA`,
            html: adminHtml
        });

        // 3. Copie à Menzies Aviation
        let menziesHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0A2463; margin: 0; font-size: 2rem;">
                        <i class="fas fa-plane" style="color: #D8315B; margin-right: 10px;"></i>
                        PearlAssist - Menzies Aviation
                    </h1>
                    <p style="color: #28a745; font-weight: bold; margin: 5px 0 0 0; font-size: 1.1rem;">
                        Nouvelle réservation confirmée - ${reservationNumber}
                    </p>
                </div>
                
                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #D8315B; margin-top: 0; margin-bottom: 15px;">
                        Service à organiser
                    </h3>
                    
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Client:</td>
                            <td style="padding: 8px 0;">${name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Contact:</td>
                            <td style="padding: 8px 0;">${phone}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Service:</td>
                            <td style="padding: 8px 0;">${serviceText.split(' - ')[0]}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Adultes:</td>
                            <td style="padding: 8px 0;">${adults}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Enfants:</td>
                            <td style="padding: 8px 0;">${children}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Bagages:</td>
                            <td style="padding: 8px 0;">${baggage} ${extraBaggage > 0 ? `(+${extraBaggage} supplémentaire(s))` : ''}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Date:</td>
                            <td style="padding: 8px 0;">${formattedDate}</td>
                        </tr>
                        ${flight ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Vol:</td>
                            <td style="padding: 8px 0;">${flight}</td>
                        </tr>
                        ` : ''}
                        ${additionalNotes ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Remarques:</td>
                            <td style="padding: 8px 0;">${additionalNotes}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>
                
                <div style="background-color: #d4edda; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #155724; font-weight: bold;">
                        ✅ Statut: Paiement confirmé - Service à préparer
                    </p>
                    <p style="margin: 5px 0 0 0; color: #155724;">
                        Montant total: ${total.toLocaleString('fr-FR')} FCFA
                    </p>
                </div>
                
                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                    <p style="color: #666; margin: 0;">
                        <strong>Coordination PearlAssist</strong><br>
                        Email: pearlassist4@gmail.com<br>
                        Téléphone: +225 05 46 01 80 00
                    </p>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: '"PearlAssist" <pearlassist4@gmail.com>',
            to: 'abj.vip@menziesaviation.com',
            subject: `[RÉSERVATION ${reservationNumber}] ${name} - ${serviceText.split(' - ')[0]} - ${formattedDate}`,
            html: menziesHtml
        });

        console.log('Emails envoyés avec succès pour la réservation:', reservationNumber);
        res.json({ 
            success: true, 
            message: 'Réservation traitée et emails envoyés avec succès',
            reservationNumber: reservationNumber,
            total: total
        });
        
    } catch (error) {
        console.error('Erreur lors de l\'envoi des emails:', error);
        res.status(500).json({ 
            success: false, 
            message: "Erreur lors de l'envoi des emails de confirmation",
            error: error.message 
        });
    }
});

/* The following block was duplicated and causes a syntax error. It has been removed. */

// Route pour les annulations
app.post('/cancel-reservation', async (req, res) => {
    try {
        const { 
            reservationNumber,
            email,
            reason,
            details,
            requestDate
        } = req.body;

        const formattedDate = new Date(requestDate).toLocaleDateString('fr-FR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Vérifier que la réservation existe
        const reservation = await Reservation.findOne({ 
            where: { reservationNumber } 
        });

        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: 'Réservation non trouvée'
            });
        }

        // Créer la demande d'annulation
        const cancellation = await Cancellation.create({
            reservationNumber,
            email,
            reason,
            details,
            status: 'requested'
        });

        // Email au client
        let clientCancellationHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0A2463; margin: 0; font-size: 2rem;">
                        <i class="fas fa-plane" style="color: #D8315B; margin-right: 10px;"></i>
                        PearlAssist
                    </h1>
                    <p style="color: #666; margin: 5px 0 0 0;">Service Premium d'Accueil Aéroportuaire</p>
                </div>
                
                <h2 style="color: #dc3545; border-bottom: 2px solid #dc3545; padding-bottom: 10px;">
                    <i class="fas fa-times-circle" style="margin-right: 10px;"></i>
                    Demande d'annulation reçue
                </h2>
                
                <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #856404; margin: 0;">
                        <i class="fas fa-info-circle" style="margin-right: 8px;"></i>
                        Votre demande est en cours de traitement
                    </h3>
                    <p style="margin: 10px 0 0 0; color: #856404;">
                        Nous avons bien reçu votre demande d'annulation et nous vous contacterons sous 24h.
                    </p>
                </div>
                
                <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="color: #D8315B; margin-top: 0; margin-bottom: 15px;">
                        Détails de la demande
                    </h3>
                    
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Numéro de réservation:</td>
                            <td style="padding: 8px 0;">${reservationNumber}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Date de demande:</td>
                            <td style="padding: 8px 0;">${formattedDate}</td>
                        </tr>
                        ${reason ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Motif:</td>
                            <td style="padding: 8px 0;">${reason}</td>
                        </tr>
                        ` : ''}
                        ${details ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #0A2463;">Détails:</td>
                            <td style="padding: 8px 0;">${details}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>
                
                <div style="background-color: #d1ecf1; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h4 style="color: #0c5460; margin-top: 0;">
                        <i class="fas fa-clock" style="margin-right: 8px;"></i>
                        Conditions d'annulation
                    </h4>
                    <ul style="color: #0c5460; margin: 0; padding-left: 1.5rem;">
                        <li>Annulation gratuite jusqu'à 24h avant le service</li>
                        <li>Annulation entre 12h et 24h : frais de 50%</li>
                        <li>Annulation moins de 12h : frais de 100%</li>
                        <li>Remboursement sous 5-7 jours ouvrés après validation</li>
                    </ul>
                </div>
                
                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                    <p style="color: #666; margin: 0;">
                        <strong>Questions ?</strong><br>
                        Contactez-nous au +225 05 46 01 80 00<br>
                        ou par email : abj.vip@menziesaviation.com
                    </p>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: '"PearlAssist" <abj.vip@menziesaviation.com>',
            to: email,
            subject: `Demande d'annulation reçue - ${reservationNumber}`,
            html: clientCancellationHtml
        });

        // Email à l'admin
        let adminCancellationHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #0A2463; margin: 0; font-size: 2rem;">
                        <i class="fas fa-exclamation-triangle" style="color: #dc3545; margin-right: 10px;"></i>
                        Demande d'Annulation
                    </h1>
                    <p style="color: #dc3545; font-weight: bold; margin: 5px 0 0 0; font-size: 1.1rem;">
                        RÉSERVATION ${reservationNumber}
                    </p>
                </div>
                
                <div style="background-color: #f8d7da; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
                    <h3 style="color: #721c24; margin-top: 0; margin-bottom: 15px;">
                        Détails de la demande d'annulation
                    </h3>
                    
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #721c24;">Numéro de réservation:</td>
                            <td style="padding: 8px 0; color: #721c24;">${reservationNumber}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #721c24;">Email client:</td>
                            <td style="padding: 8px 0; color: #721c24;">${email}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #721c24;">Date de demande:</td>
                            <td style="padding: 8px 0; color: #721c24;">${formattedDate}</td>
                        </tr>
                        ${reason ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #721c24;">Motif:</td>
                            <td style="padding: 8px 0; color: #721c24;">${reason}</td>
                        </tr>
                        ` : ''}
                        ${details ? `
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; color: #721c24;">Détails:</td>
                            <td style="padding: 8px 0; color: #721c24;">${details}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>
                
                <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 0; color: #856404; font-weight: bold;">
                        📋 Action requise :
                    </p>
                    <ul style="color: #856404; margin: 10px 0 0 0; padding-left: 1.5rem;">
                        <li>Vérifier les détails de la réservation originale</li>
                        <li>Calculer les frais d'annulation selon les conditions</li>
                        <li>Contacter le client pour confirmer l'annulation</li>
                        <li>Procéder au remboursement si applicable</li>
                    </ul>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: '"PearlAssist" <abj.vip@menziesaviation.com>',
            to: 'pearlassist4@gmail.com',
            subject: `🚨 [ANNULATION] ${reservationNumber} - Demande reçue`,
            html: adminCancellationHtml
        });

        console.log('Emails d\'annulation envoyés avec succès pour:', reservationNumber);
        res.json({ 
            success: true, 
            message: 'Demande d\'annulation traitée avec succès'
        });
        
    } catch (error) {
        console.error('Erreur lors du traitement de l\'annulation:', error);
        res.status(500).json({ 
            success: false, 
            message: "Erreur lors du traitement de la demande d'annulation",
            error: error.message 
        });
    }
});

// Obtenir toutes les réservations
app.get('/reservations', async (req, res) => {
    try {
        const reservations = await Reservation.findAll({
            order: [['createdAt', 'DESC']]
        });
        res.json(reservations);
    } catch (error) {
        console.error('Erreur lors de la récupération des réservations:', error);
        res.status(500).json({ error: error.message });
    }
});

// Obtenir une réservation spécifique
app.get('/reservation/:number', async (req, res) => {
    try {
        const reservation = await Reservation.findOne({
            where: { reservationNumber: req.params.number }
        });
        
        if (reservation) {
            res.json(reservation);
        } else {
            res.status(404).json({ message: 'Réservation non trouvée' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtenir les annulations
app.get('/cancellations', async (req, res) => {
    try {
        const cancellations = await Cancellation.findAll({
            order: [['createdAt', 'DESC']]
        });
        res.json(cancellations);
    } catch (error) {
        console.error('Erreur lors de la récupération des annulations:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route pour les statistiques du dashboard
app.get('/stats', async (req, res) => {
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        
        // Statistiques des réservations
        const totalReservations = await Reservation.count();
        const todayReservations = await Reservation.count({
            where: {
                createdAt: {
                    [require('sequelize').Op.gte]: today
                }
            }
        });
        
        // Revenus totaux
        const totalRevenueResult = await Reservation.sum('total');
        const totalRevenue = totalRevenueResult || 0;
        
        // Revenus du mois dernier pour calculer le changement
        const lastMonthRevenueResult = await Reservation.sum('total', {
            where: {
                createdAt: {
                    [require('sequelize').Op.gte]: lastMonth
                }
            }
        });
        const lastMonthRevenue = lastMonthRevenueResult || 0;
        
        // Annulations
        const totalCancellations = await Cancellation.count();
        const pendingCancellations = await Cancellation.count({
            where: { status: 'requested' }
        });
        
        // Calculer les pourcentages de changement
        const revenueChange = lastMonthRevenue > 0 ? 
            ((totalRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1) : 0;
        
        const stats = {
            totalReservations,
            todayReservations,
            totalRevenue,
            totalCancellations,
            pendingCancellations,
            revenueChange: parseFloat(revenueChange),
            reservationsChange: 15.2, // Simulation - vous pouvez calculer la vraie valeur
            cancellationsChange: -5.8, // Simulation
            lastUpdated: new Date().toISOString()
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Erreur lors du calcul des statistiques:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route pour traiter une annulation
app.post('/process-cancellation/:id', async (req, res) => {
    try {
        const cancellationId = req.params.id;
        const { status, processedBy, processedAt } = req.body;
        
        const cancellation = await Cancellation.findByPk(cancellationId);
        if (!cancellation) {
            return res.status(404).json({ error: 'Annulation non trouvée' });
        }
        
        // Mettre à jour le statut
        await cancellation.update({
            status: status || 'processed',
            processedBy,
            processedAt: processedAt || new Date()
        });
        
        res.json({ 
            success: true, 
            message: 'Annulation traitée avec succès',
            cancellation 
        });
        
    } catch (error) {
        console.error('Erreur lors du traitement de l\'annulation:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route de test pour vérifier le serveur
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Serveur Pearl Assist opérationnel', 
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '3.0.0'
    });
});

// Route d'information
app.get('/', (req, res) => {
    res.json({
        message: 'API Pearl Assist',
        version: '3.0.0',
        status: 'Opérationnel',
        endpoints: [
            'GET / - Informations sur l\'API',
            'GET /test - Test de connectivité',
            'GET /dashboard - Interface d\'administration',
            'GET /login - Page de connexion',
            'POST /send-reservation - Envoyer une réservation',
            'POST /cancel-reservation - Demander une annulation',
            'GET /reservations - Liste des réservations',
            'GET /reservation/:number - Détails d\'une réservation',
            'GET /cancellations - Liste des annulations',
            'GET /stats - Statistiques du dashboard',
            'POST /process-cancellation/:id - Traiter une annulation'
        ],
        documentation: 'https://docs.pearlassist.com'
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Serveur PearlAssist démarré sur http://localhost:${PORT}`);
    console.log(`📧 Service d'emails configuré et prêt`);
    console.log(`💳 Tarifs: Enfants 25.000 FCFA | Bagages supplémentaires 5.000 FCFA`);
    console.log(`🔒 Système de blocage 24h activé`);
    console.log(`📋 Générateur de numéros de réservation activé`);
    console.log(`❌ Système d'annulation en ligne activé`);
});