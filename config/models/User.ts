// Import necessary modules from Sequelize
import {
    Model,
    DataTypes,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
} from 'sequelize';
import { sequelize } from '../db'; // Adjust the import path as necessary

// Define the model class
class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
    declare id: CreationOptional<string>;
    declare email: string;
    declare firstName: string;
    declare lastName: string | null;
    declare method: string;
    declare hashedPassword: string | null;
    declare isVerified: boolean;
    declare createdAt: Date;
    declare updatedAt: Date;
}

// Initialize the model with its configuration
User.init(
    {
        id: {
            type: DataTypes.STRING,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        firstName: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        lastName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        method: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        hashedPassword: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        isVerified: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        updatedAt: {
            type: DataTypes.DATE,
        },
    },
    {
        sequelize,
        modelName: 'users',
        timestamps: true,
        paranoid: true,
        underscored: true,
    }
);
User.sync({ alter: true })
// Export the model
export default User;