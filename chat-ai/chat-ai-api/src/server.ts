import express, {Request, Response} from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { StreamChat } from 'stream-chat';
import OpenAI from 'openai';
import { db } from './config/database.js';
import { chats, users } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { ChatCompletionMessageParam } from 'openai/resources';


dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false}));

// Initialize Stream Chat client
const chatClient = StreamChat.getInstance(
    process.env.STREAM_API_KEY!, 
    process.env.STREAM_API_SECRET!
);

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,    
})

// Register user with Stream Chat
app.post('/register-user', async (req : Request, res: Response ) :Promise<any> => {
    const { name, email} = req.body;

    if (!name || !email) {
        return res.status(400).json({ message : 'Name and email are required' })
    }
    try {
        const userId = email.replace(/[^a-zA-Z0-9_-]/g, '_');

        // Check if user already exists
        const userResponse = await chatClient.queryUsers({ id: { $eq: userId}});
        if (!userResponse.users.length) {
            //  Add new user to Stream
            await chatClient.upsertUser({ 
                id: userId,
                name, 
                role: 'user',
                email
            } as any);
        }

        // chekc if user exists in database
        const exisitingUser = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))

        if (!exisitingUser.length) {
            console.log(`User ${userId} does not exist in the database. Creating new user...`)
            await db.insert(users).values({ userId, name, email });
        }



        res.status(200).json({ userId, name, email  })
    } catch (error) {
        
        res.status(500).json({ error : 'Internal Server Error' })
    }
});

// Send message to ai
app.post('/chat', async (req : Request, res: Response): Promise<any> => {
    const { message, userId} = req.body;
    if (!message || !userId) {
        return res.status(400).json({ message : 'Message and user are required' })
    }
    try {
    //  Verify user exists
    const userResponse = await chatClient.queryUsers({ id: {$eq: userId}});
    if (!userResponse.users.length) {
        return res.status(404).json({error: 'User not found. Please register first.'})
    }

    // Check if user exists in database

      const exisitingUser = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))

         if (!exisitingUser.length) {
            return res.status(404).json({error: 'User not found in database. Please register first.'})
        }

        // Fetch user past messages for context
          const chatHistory = await db
        .select()
        .from(chats)
        .where(eq(chats.userId, userId))
        .orderBy(chats.createdAt)
        .limit(10);

        // Format messages for OpenAI
        const conversation : ChatCompletionMessageParam[] =  chatHistory.flatMap((chat)=> [
            { role: 'user', content: chat.message},
            { role: 'assistant', content: chat.reply}
        ]) 

        // Add lastest user messages to the conversation
        conversation.push({role: 'user', content: message})

    //  Send message to GTP-4
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: conversation as ChatCompletionMessageParam[],
    });
       const aiMessage: string = response.choices[0].message?.content ?? 'No response from AI';
      
    //   Save message to database
    await db.insert(chats).values({
        userId,
        message,
        reply: aiMessage
    });
      
      
       // Create a channel
       const channel = chatClient.channel('messaging', `chat-${userId}`, {
        // name: 'Ai Chat',
        created_by_id: 'ai_bot'
       })

       await channel.create();
       await channel.sendMessage({text: aiMessage, user_id: 'ai_bot'});
       return res.status(200).json({ reply: aiMessage })
    } catch (error) {
        console.log('Error generating AI reponse:', error)
        res.status(500).json({ error : 'Internal Server Error' })
    }
})

// Get chat history for a user
app.post('/get-messages', async (req : Request, res: Response): Promise<any> => {
    const { userId} = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required'})
    }
    try {
        const chatHistory = await db
        .select()
        .from(chats)
        .where(eq(chats.userId, userId))
        res.status(200).json({ messages:  chatHistory})
    } catch (error) {
        console.log("Error fetching chat history:", error)
        res.status(500).json({ error: 'Internal Server Erro'})
    }
} )

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {console.log(`Server is running on port ${PORT}`)});

