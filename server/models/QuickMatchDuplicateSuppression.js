const { DataTypes, Model } = require('sequelize')

class QuickMatchDuplicateSuppression extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {string} */
    this.id
    /** @type {string} */
    this.groupKey
    /** @type {string} */
    this.groupFingerprint
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
    /** @type {string} */
    this.sessionId
    /** @type {string} */
    this.createdByUserId
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
        groupKey: {
          type: DataTypes.STRING,
          allowNull: false
        },
        groupFingerprint: {
          type: DataTypes.TEXT,
          allowNull: false
        }
      },
      {
        sequelize,
        modelName: 'quickMatchDuplicateSuppression',
        indexes: [
          { unique: true, fields: ['sessionId', 'groupKey'] },
          { fields: ['sessionId'] },
          { fields: ['createdByUserId'] }
        ]
      }
    )

    const { quickMatchSession, user } = sequelize.models

    quickMatchSession.hasMany(QuickMatchDuplicateSuppression, {
      foreignKey: 'sessionId',
      as: 'duplicateSuppressions',
      onDelete: 'CASCADE'
    })
    QuickMatchDuplicateSuppression.belongsTo(quickMatchSession, {
      foreignKey: 'sessionId',
      as: 'session',
      onDelete: 'CASCADE'
    })

    user.hasMany(QuickMatchDuplicateSuppression, {
      foreignKey: 'createdByUserId',
      as: 'quickMatchDuplicateSuppressions'
    })
    QuickMatchDuplicateSuppression.belongsTo(user, {
      foreignKey: 'createdByUserId',
      as: 'createdByUser'
    })
  }
}

module.exports = QuickMatchDuplicateSuppression
