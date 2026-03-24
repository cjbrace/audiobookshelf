const { DataTypes, Model } = require('sequelize')

class SeriesReviewNameControl extends Model {
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
        controlType: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'alias'
        },
        aliasName: {
          type: DataTypes.STRING,
          allowNull: false
        },
        aliasNameNormalized: {
          type: DataTypes.STRING,
          allowNull: false
        },
        aliasDecisionKey: {
          type: DataTypes.STRING,
          allowNull: false
        },
        canonicalName: {
          type: DataTypes.STRING,
          allowNull: false
        },
        canonicalNameNormalized: {
          type: DataTypes.STRING,
          allowNull: false
        },
        canonicalDecisionKey: {
          type: DataTypes.STRING,
          allowNull: false
        }
      },
      {
        sequelize,
        modelName: 'seriesReviewNameControl',
        indexes: [
          {
            name: 'seriesReviewNameControl_library_alias_key',
            unique: true,
            fields: ['libraryId', 'aliasNameNormalized']
          },
          {
            fields: ['libraryId', 'aliasDecisionKey']
          },
          {
            fields: ['libraryId', 'canonicalDecisionKey']
          }
        ]
      }
    )

    const { library, user } = sequelize.models

    library.hasMany(SeriesReviewNameControl, {
      foreignKey: 'libraryId',
      as: 'seriesReviewNameControls',
      onDelete: 'CASCADE'
    })
    SeriesReviewNameControl.belongsTo(library, {
      foreignKey: 'libraryId',
      as: 'library',
      onDelete: 'CASCADE'
    })

    user.hasMany(SeriesReviewNameControl, {
      foreignKey: 'createdByUserId',
      as: 'seriesReviewNameControls'
    })
    SeriesReviewNameControl.belongsTo(user, {
      foreignKey: 'createdByUserId',
      as: 'createdByUser'
    })
  }
}

module.exports = SeriesReviewNameControl
