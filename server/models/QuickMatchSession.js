const { DataTypes, Model } = require('sequelize')

class QuickMatchSession extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {string} */
    this.id
    /** @type {string} */
    this.status
    /** @type {string} */
    this.notes
    /** @type {Date} */
    this.startedAt
    /** @type {Date} */
    this.endedAt
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
    /** @type {string} */
    this.startedByUserId
  }

  /**
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        status: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'running'
        },
        notes: DataTypes.TEXT,
        startedAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        endedAt: DataTypes.DATE
      },
      {
        sequelize,
        modelName: 'quickMatchSession',
        indexes: [
          { fields: ['status'] },
          { fields: ['startedByUserId'] },
          { fields: ['startedAt'] }
        ]
      }
    )

    const { user } = sequelize.models
    QuickMatchSession.belongsTo(user, {
      foreignKey: 'startedByUserId',
      as: 'startedByUser',
      onDelete: 'CASCADE'
    })
    user.hasMany(QuickMatchSession, {
      foreignKey: 'startedByUserId',
      as: 'quickMatchSessions'
    })
  }
}

module.exports = QuickMatchSession
