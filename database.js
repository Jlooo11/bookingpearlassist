const { Sequelize, DataTypes } = require('sequelize');

// Initialisation de la base de données SQLite
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: 'pearlassist.db', // Le fichier de base de données sera créé automatiquement
  logging: false // Désactive les logs SQL pour la production
});

// Modèle pour les réservations
const Reservation = sequelize.define('Reservation', {
  reservationNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  service: {
    type: DataTypes.STRING,
    allowNull: false
  },
  serviceText: {
    type: DataTypes.STRING,
    allowNull: false
  },
  adults: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  children: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  baggage: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  extraBaggage: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  baggageFees: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  date: {
    type: DataTypes.DATE,
    allowNull: false
  },
  flight: {
    type: DataTypes.STRING
  },
  total: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  childPrice: {
    type: DataTypes.INTEGER,
    defaultValue: 25000
  },
  additionalNotes: {
    type: DataTypes.TEXT
  },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'cancelled'),
    defaultValue: 'pending'
  },
  paymentConfirmed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

// Modèle pour les annulations
const Cancellation = sequelize.define('Cancellation', {
  reservationNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false
  },
  reason: {
    type: DataTypes.STRING
  },
  details: {
    type: DataTypes.TEXT
  },
  status: {
    type: DataTypes.ENUM('requested', 'processed', 'refunded', 'denied'),
    defaultValue: 'requested'
  },
  refundAmount: {
    type: DataTypes.INTEGER
  },
  processedBy: {
    type: DataTypes.STRING
  },
  processedAt: {
    type: DataTypes.DATE
  }
});

// Relation entre les modèles
Reservation.hasMany(Cancellation, { foreignKey: 'reservationNumber', sourceKey: 'reservationNumber' });
Cancellation.belongsTo(Reservation, { foreignKey: 'reservationNumber', targetKey: 'reservationNumber' });

// Fonction pour initialiser la base de données
async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connexion à la base de données SQLite établie avec succès.');
    
    // Synchronisation des modèles avec la base de données
    // ATTENTION: force: true supprime et recrée les tables à chaque démarrage
    // En production, utilisez { force: false } ou des migrations
    await sequelize.sync({ force: false }); 
    
    console.log('📊 Base de données synchronisée');
    
    // Compter les enregistrements existants
    const reservationCount = await Reservation.count();
    const cancellationCount = await Cancellation.count();
    
    console.log(`📋 ${reservationCount} réservation(s) en base`);
    console.log(`❌ ${cancellationCount} annulation(s) en base`);
    
  } catch (error) {
    console.error('❌ Impossible de se connecter à la base de données:', error);
  }
}

module.exports = {
  sequelize,
  Reservation,
  Cancellation,
  initializeDatabase
};