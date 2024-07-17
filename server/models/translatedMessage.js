import mongoose, { Schema, model, Types } from "mongoose";

const schema = new Schema(
  {
    content: String,

    attachments: [
      {
        public_id: {
          type: String,
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
      },
    ],

    sender: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },

    receiver: {
      type: Types.ObjectId,
      ref: "User",
      required: false,
    },
      
    chat: {
      type: Types.ObjectId,
      ref: "Chat",
      required: true,
    },

    targetLanguage: {
      type: String, // Store the language code (e.g., 'en', 'fr', 'es')
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const TranslatedMessage = mongoose.models.TranslatedMessage || model("TranslatedMessage", schema);
