import express from "express";
import { connectDB } from "./utils/features.js";
import dotenv from "dotenv";
import { errorMiddleware } from "./middlewares/error.js";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { createServer } from "http";
import { v4 as uuid } from "uuid";
import cors from "cors";
import axios from 'axios'; // Import axios library
import { v2 as cloudinary } from "cloudinary";
import {
  CHAT_JOINED,
  CHAT_LEAVED,
  NEW_MESSAGE,
  NEW_MESSAGE_ALERT,
  ONLINE_USERS,
  START_TYPING,
  STOP_TYPING,
} from "./constants/events.js";
import { getSockets } from "./lib/helper.js";
import { Message } from "./models/message.js";
import { corsOptions } from "./constants/config.js";
import { socketAuthenticator } from "./middlewares/auth.js";

import userRoute from "./routes/user.js";
import chatRoute from "./routes/chat.js";
import adminRoute from "./routes/admin.js";
import { log } from "console";
import { TranslatedMessage } from "./models/translatedMessage.js";
import { User } from "./models/user.js";

dotenv.config({
  path: "./.env",
});

const mongoURI = process.env.MONGO_URI;
const port = process.env.PORT || 3000;
const envMode = process.env.NODE_ENV.trim() || "PRODUCTION";
const adminSecretKey = process.env.ADMIN_SECRET_KEY || "adsasdsdfsdfsdfd";
const userSocketIDs = new Map();
const onlineUsers = new Set();

connectDB(mongoURI);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: corsOptions,
});

app.set("io", io);

// Using Middlewares Here
app.use(express.json());
app.use(cookieParser());
app.use(cors(corsOptions));

app.use("/api/v1/user", userRoute);
app.use("/api/v1/chat", chatRoute);
app.use("/api/v1/admin", adminRoute);


// const axios = require('axios');

async function translateMessage(message, sourceLanguage, targetLanguage) {
  try {
    const response = await axios.post('https://api.translateplus.io/v1/translate', {
      text: message,
      source: sourceLanguage,
      target: targetLanguage

    }, {
      headers: {
        'X-API-KEY': '98e0df0cdd6d814cde9421d4cc8a8e24169fda75',
        'Content-Type': 'application/json'
      }
    });
    // console.count(response)
    // console.log('response', response);
    return response.data.translations.translation;
  } catch (error) {
    console.error('Error translating message:');
    return message; // Return original message if translation fails
  }
}

async function detectLanguage(message) {
  try {
    const response = await axios.post('https://api.translateplus.io/v1/language_detect', {
      text: message
    }, {
      headers: {
        'X-API-KEY': '98e0df0cdd6d814cde9421d4cc8a8e24169fda75',
        'Content-Type': 'application/json'
      }
    })
    return response.data.language_detection.language;
  } catch (error) {
    console.error(error);
    return message;
  }
}


app.get("/", (req, res) => {
  res.send("Hello World");
});

io.use((socket, next) => {
  cookieParser()(
    socket.request,
    socket.request.res,
    async (err) => await socketAuthenticator(err, socket, next)
  );
});

io.on("connection", (socket) => {


  const user = socket.user;
  //  console.log(user);
  userSocketIDs.set(user._id.toString(), socket.id);


  socket.on(NEW_MESSAGE, async ({ chatId, members, message }) => {
    const sourceLanguage = user.language;
    console.log("source", sourceLanguage);
    const receiverIds = members.filter(member => member !== user._id.toString());
    console.log("members:", members);
    console.log("receivers:", receiverIds);

    const receiver = await User.findById(receiverIds)
    console.log('receiver', receiver);
    const targetLanguage = receiver.language;
    console.log('targetLanguage', targetLanguage);
    // Translate the message if necessary
    const translatedMessage =  await translateMessage(message, sourceLanguage, targetLanguage)  

    // Get the sender's socket ID
    console.log("Translated message: ", translatedMessage);
    const senderSocketId = userSocketIDs.get(user._id.toString());
    console.log("sender id", user._id.toString());
    console.log("sendersocket ", senderSocketId,);
    // Emit original message to the sender's socket

    await io.to(senderSocketId).emit(NEW_MESSAGE, {
      chatId,
      message: {
        content: message,
        _id: uuid(),
        sender: {
          _id: user._id,
          name: user.name,
        },
        chat: chatId,
        createdAt: new Date().toISOString(),
      }
    });

    // Iterate through each member in the conversation
    await Promise.all(receiverIds.map(async (member) => {
      // Translate the message if necessary
      console.log('member', member);
      const receiverSocketId = member ? userSocketIDs.get(member.toString()) : null;

      if (receiverSocketId) {
        console.log('Sending translated message to receiver:', translatedMessage);

        // Emit translated message to the receiver's socket
        await io.to(receiverSocketId).emit(NEW_MESSAGE, {
          chatId,
          message: {
            content: translatedMessage,
            _id: uuid(),
            sender: {
              _id: user._id,
              name: user.name,
            },
            chat: chatId,
            createdAt: new Date().toISOString(),
          }
        });
      } else {
        console.error('Receiver socket ID not available for member:', member);
      }
    }));

    // Emit a new message alert to all members except the sender

    io.to(getSockets(receiverIds)).emit(NEW_MESSAGE_ALERT, { chatId });

    try {
      // Save the original message to the database
      await TranslatedMessage.create({
        content: translatedMessage,
        sender: user._id,
        chat: chatId,
        targetLanguage: targetLanguage,
      });

      await Message.create({
        content: message,
        sender: user._id,
        chat: chatId,
      });
    } catch (error) {
      console.error('Error saving message to database:', error);
    }
  });




  socket.on(START_TYPING, ({ members, chatId }) => {
    const membersSockets = getSockets(members);
    socket.to(membersSockets).emit(START_TYPING, { chatId });
  });

  socket.on(STOP_TYPING, ({ members, chatId }) => {
    const membersSockets = getSockets(members);
    socket.to(membersSockets).emit(STOP_TYPING, { chatId });
  });

  socket.on(CHAT_JOINED, ({ userId, members }) => {
    onlineUsers.add(userId.toString());

    const membersSocket = getSockets(members);
    io.to(membersSocket).emit(ONLINE_USERS, Array.from(onlineUsers));
  });

  socket.on(CHAT_LEAVED, ({ userId, members }) => {
    onlineUsers.delete(userId.toString());

    const membersSocket = getSockets(members);
    io.to(membersSocket).emit(ONLINE_USERS, Array.from(onlineUsers));
  });

  socket.on("disconnect", () => {
    userSocketIDs.delete(user._id.toString());
    onlineUsers.delete(user._id.toString());
    socket.broadcast.emit(ONLINE_USERS, Array.from(onlineUsers));
  });
});

app.use(errorMiddleware);

server.listen(port, () => {
  console.log(`Server is running on port ${port} in ${envMode} Mode`);
});

export { envMode, adminSecretKey, userSocketIDs };
