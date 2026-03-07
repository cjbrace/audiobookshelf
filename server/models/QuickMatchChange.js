const { DataTypes, Model } = require('sequelize')

class QuickMatchChange extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {string} */
    this.id
    /** @type {string} */
    this.status
    /** @type {string} */
    this.provider
    /** @type {string} */
    this.warningText
    /** @type {string} */
    this.errorText
    /** @type {string} */
    this.libraryItemTitle
    /** @type {object} */
    this.beforeData
    /** @type {object} */
    this.afterData
    /** @type {string} */
    this.revertStatus
    /** @type {Date} */
    this.revertedAt
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
    /** @type {string} */
    this.sessionId
    /** @type {string} */
    this.libraryItemId
    /** @type {string} */
    this.userId
    /** @type {string} */
    this.revertedByUserId
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
          allowNull: false
        },
        provider: DataTypes.STRING,
        warningText: DataTypes.TEXT,
        errorText: DataTypes.TEXT,
        libraryItemTitle: DataTypes.STRING,
        beforeData: DataTypes.JSON,
        afterData: DataTypes.JSON,
        revertStatus: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'not_reverted'
        },
        revertedAt: DataTypes.DATE
      },
      {
        sequelize,
        modelName: 'quickMatchChange',
        indexes: [
          { fields: ['sessionId', 'createdAt'] },
          { fields: ['libraryItemId'] },
          { fields: ['status'] },
          { fields: ['revertStatus'] }
        ]
      }
    )

    const { quickMatchSession, libraryItem, user } = sequelize.models

    quickMatchSession.hasMany(QuickMatchChange, {
      foreignKey: 'sessionId',
      as: 'changes',
      onDelete: 'CASCADE'
    })
    QuickMatchChange.belongsTo(quickMatchSession, {
      foreignKey: 'sessionId',
      as: 'session',
      onDelete: 'CASCADE'
    })

    libraryItem.hasMany(QuickMatchChange, {
      foreignKey: 'libraryItemId',
      as: 'quickMatchChanges'
    })
    QuickMatchChange.belongsTo(libraryItem, {
      foreignKey: 'libraryItemId',
      as: 'libraryItem'
    })

    user.hasMany(QuickMatchChange, {
      foreignKey: 'userId',
      as: 'quickMatchChanges'
    })
    QuickMatchChange.belongsTo(user, {
      foreignKey: 'userId',
      as: 'user'
    })

    user.hasMany(QuickMatchChange, {
      foreignKey: 'revertedByUserId',
      as: 'quickMatchReverts'
    })
    QuickMatchChange.belongsTo(user, {
      foreignKey: 'revertedByUserId',
      as: 'revertedByUser'
    })
  }
}

module.exports = QuickMatchChange
