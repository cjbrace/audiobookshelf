const { DataTypes, Model } = require('sequelize')

class QuickMatchFullMatchQueue extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {string} */
    this.id
    /** @type {string} */
    this.status
    /** @type {Date} */
    this.completedAt
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
    /** @type {string} */
    this.sessionId
    /** @type {string} */
    this.changeId
    /** @type {string} */
    this.libraryItemId
    /** @type {string} */
    this.queuedByUserId
    /** @type {string} */
    this.completedByUserId
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
          defaultValue: 'queued'
        },
        completedAt: DataTypes.DATE
      },
      {
        sequelize,
        modelName: 'quickMatchFullMatchQueue',
        indexes: [
          { fields: ['sessionId', 'status'] },
          { fields: ['libraryItemId'] },
          { unique: true, fields: ['changeId'] }
        ]
      }
    )

    const { quickMatchSession, quickMatchChange, libraryItem, user } = sequelize.models

    quickMatchSession.hasMany(QuickMatchFullMatchQueue, { foreignKey: 'sessionId', as: 'fullMatchQueue', onDelete: 'CASCADE' })
    QuickMatchFullMatchQueue.belongsTo(quickMatchSession, { foreignKey: 'sessionId', as: 'session', onDelete: 'CASCADE' })

    quickMatchChange.hasMany(QuickMatchFullMatchQueue, { foreignKey: 'changeId', as: 'fullMatchQueueEntries' })
    QuickMatchFullMatchQueue.belongsTo(quickMatchChange, { foreignKey: 'changeId', as: 'change' })

    libraryItem.hasMany(QuickMatchFullMatchQueue, { foreignKey: 'libraryItemId', as: 'fullMatchQueueEntries' })
    QuickMatchFullMatchQueue.belongsTo(libraryItem, { foreignKey: 'libraryItemId', as: 'libraryItem' })

    user.hasMany(QuickMatchFullMatchQueue, { foreignKey: 'queuedByUserId', as: 'queuedFullMatchItems' })
    QuickMatchFullMatchQueue.belongsTo(user, { foreignKey: 'queuedByUserId', as: 'queuedByUser' })

    user.hasMany(QuickMatchFullMatchQueue, { foreignKey: 'completedByUserId', as: 'completedFullMatchItems' })
    QuickMatchFullMatchQueue.belongsTo(user, { foreignKey: 'completedByUserId', as: 'completedByUser' })
  }
}

module.exports = QuickMatchFullMatchQueue
