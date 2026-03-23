const { DataTypes, Model } = require('sequelize')

class SeriesReviewAction extends Model {
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
        actionType: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'rename_merge'
        },
        sourceSeriesIds: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: []
        },
        sourceSeriesNames: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: []
        },
        targetLabel: {
          type: DataTypes.STRING,
          allowNull: false
        },
        beforeData: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: []
        },
        afterData: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: []
        },
        revertStatus: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'not_reverted'
        },
        revertedAt: DataTypes.DATE
      },
      {
        sequelize,
        modelName: 'seriesReviewAction',
        indexes: [
          { fields: ['libraryId', 'createdAt'] },
          { fields: ['userId'] },
          { fields: ['revertStatus'] }
        ]
      }
    )

    const { library, user } = sequelize.models

    library.hasMany(SeriesReviewAction, {
      foreignKey: 'libraryId',
      as: 'seriesReviewActions',
      onDelete: 'CASCADE'
    })
    SeriesReviewAction.belongsTo(library, {
      foreignKey: 'libraryId',
      as: 'library',
      onDelete: 'CASCADE'
    })

    user.hasMany(SeriesReviewAction, {
      foreignKey: 'userId',
      as: 'seriesReviewActions'
    })
    SeriesReviewAction.belongsTo(user, {
      foreignKey: 'userId',
      as: 'user'
    })

    user.hasMany(SeriesReviewAction, {
      foreignKey: 'revertedByUserId',
      as: 'seriesReviewActionReverts'
    })
    SeriesReviewAction.belongsTo(user, {
      foreignKey: 'revertedByUserId',
      as: 'revertedByUser'
    })
  }
}

module.exports = SeriesReviewAction
