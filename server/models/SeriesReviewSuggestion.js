const { DataTypes, Model } = require('sequelize')

class SeriesReviewSuggestion extends Model {
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
        kind: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'series'
        },
        suggestionKey: {
          type: DataTypes.STRING,
          allowNull: false
        },
        suggestedName: DataTypes.STRING,
        suggestedNameNormalized: DataTypes.STRING,
        suggestedSequence: DataTypes.STRING,
        state: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'pending'
        },
        decisionAction: DataTypes.STRING,
        decisionSeriesId: DataTypes.STRING,
        contributions: {
          type: DataTypes.JSON,
          allowNull: false,
          defaultValue: []
        },
        firstSeenAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        lastSeenAt: {
          type: DataTypes.DATE,
          allowNull: false
        },
        decidedAt: DataTypes.DATE,
        isActive: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true
        }
      },
      {
        sequelize,
        modelName: 'seriesReviewSuggestion',
        indexes: [
          {
            name: 'seriesReviewSuggestion_libraryItem_key',
            unique: true,
            fields: ['libraryItemId', 'suggestionKey']
          },
          {
            fields: ['libraryId', 'state']
          },
          {
            fields: ['libraryItemId', 'isActive']
          }
        ]
      }
    )

    const { library, libraryItem, user } = sequelize.models

    library.hasMany(SeriesReviewSuggestion, {
      foreignKey: 'libraryId',
      as: 'seriesReviewSuggestions',
      onDelete: 'CASCADE'
    })
    SeriesReviewSuggestion.belongsTo(library, {
      foreignKey: 'libraryId',
      as: 'library',
      onDelete: 'CASCADE'
    })

    libraryItem.hasMany(SeriesReviewSuggestion, {
      foreignKey: 'libraryItemId',
      as: 'seriesReviewSuggestions',
      onDelete: 'CASCADE'
    })
    SeriesReviewSuggestion.belongsTo(libraryItem, {
      foreignKey: 'libraryItemId',
      as: 'libraryItem',
      onDelete: 'CASCADE'
    })

    user.hasMany(SeriesReviewSuggestion, {
      foreignKey: 'decidedByUserId',
      as: 'seriesReviewDecisions'
    })
    SeriesReviewSuggestion.belongsTo(user, {
      foreignKey: 'decidedByUserId',
      as: 'decidedByUser'
    })
  }
}

module.exports = SeriesReviewSuggestion
