import asyncio
import websockets
import json
from pymongo import MongoClient

# Database setup
client = MongoClient("mongodb://localhost:27017/")
db = client["chatdb"]
roomsCollection = db["rooms"]

# Global client tracking (consider if still needed with Room object)
connectedClients = set() # Using a set for faster add/remove

class Room:
    def __init__(self, name: str):
        self.name = name
        self.clients = set() # Use a set for efficient client management
        self.data = "[]"
        self.count = 0
        self._loadFromDb()

    def _loadFromDb(self):
        """Loads room data from the database or initializes it if not found."""
        doc = roomsCollection.find_one({"name": self.name})
        if doc:
            self.data = doc.get("data", "[]")
            self.count = doc.get("count", 0)
        else:
            # If room doesn't exist, create it in DB
            roomsCollection.insert_one({
                "name": self.name,
                "count": self.count,
                "data": self.data
            })

    async def addClient(self, websocket):
        """Adds a client to the room."""
        self.clients.add(websocket)

    async def removeClient(self, websocket):
        """Removes a client from the room."""
        self.clients.discard(websocket) # discard won't raise error if item not found

    async def getGamestate(self):
        """Returns the current gamestate for the room."""
        return {
            "type": "gamestate",
            "count": self.count,
            "data": self.data
        }

    async def updateGamestate(self, newData: str, newCount: int):
        """Updates the gamestate and persists it to the database."""
        self.data = newData
        self.count = newCount
        roomsCollection.update_one(
            {"name": self.name},
            {"$set": {"data": self.data, "count": self.count}}
        )

    async def broadcast(self, message: str, senderWebsocket=None):
        """Broadcasts a message to all clients in the room, optionally excluding the sender."""
        if not self.clients:
            return

        # Create a list of tasks for sending messages
        sendTasks = []
        for client in list(self.clients): # Iterate over a copy if clients might change during loop
            if client != senderWebsocket:
                sendTasks.append(client.send(message))
        
        # Run all send tasks concurrently
        if sendTasks:
            await asyncio.gather(*sendTasks, return_exceptions=True) # returns results/exceptions

# Dictionary to hold active Room objects
activeRooms = {}
# Maps websocket to its current room name
websocketToRoomMap = {}

async def getOrCreateRoom(roomName: str) -> Room:
    """Retrieves an existing room or creates a new one."""
    if roomName not in activeRooms:
        activeRooms[roomName] = Room(roomName)
    return activeRooms[roomName]

async def handler(websocket, path):
    # Register client
    connectedClients.add(websocket)
    print(f"Client connected: {websocket.remote_address}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                print(f"Received non-JSON message: {message}")
                continue

            msgType = data.get('type')
            
            if msgType == "ping":
                await websocket.send(json.dumps({ "type": "pong" }))
                continue

            elif msgType == "get_rooms":
                roomsList = list(roomsCollection.find({}, {"_id": 0, "name": 1}))
                await websocket.send(json.dumps({
                    "type": "rooms",
                    "rooms": roomsList
                }))

            elif msgType == "sync" or msgType == "create_room":
                roomName = data.get("room")
                if not roomName:
                    print(f"No room name provided for '{msgType}' message.")
                    continue

                room = await getOrCreateRoom(roomName)
                await room.addClient(websocket)
                websocketToRoomMap[websocket] = roomName

                if msgType == "create_room":
                    # When creating a room, ensure the client gets the initial empty state
                    await websocket.send(json.dumps({
                        "type": "gamestate",
                        "data": "[]", # New rooms start with empty data
                        "count": 0
                    }))
                    # Also notify all clients that a new room is available
                    roomsList = list(roomsCollection.find({}, {"_id": 0, "name": 1}))
                    for clientWs in connectedClients:
                        # Send updated room list to all connected clients
                        await clientWs.send(json.dumps({
                            "type": "rooms",
                            "rooms": roomsList
                        }))
                else: # msgType == "sync"
                    await websocket.send(json.dumps(await room.getGamestate()))

            elif msgType == "gamestate":
                roomName = websocketToRoomMap.get(websocket)
                if not roomName:
                    print(f"Client {websocket.remote_address} not associated with a room for gamestate update.")
                    continue
                
                room = activeRooms.get(roomName)
                if room:
                    newData = data.get("data")
                    newCount = data.get("count")
                    if newData is not None and newCount is not None:
                        await room.updateGamestate(newData, newCount)
                        # Broadcast the updated gamestate to other clients in the room
                        await room.broadcast(message, senderWebsocket=websocket)
                else:
                    print(f"Room '{roomName}' not found for gamestate update.")

            else:
                # For any other message type, if the client is in a room, broadcast it
                roomName = websocketToRoomMap.get(websocket)
                if roomName:
                    room = activeRooms.get(roomName)
                    if room:
                        await room.broadcast(message, senderWebsocket=websocket)
                else:
                    print(f"Unhandled message type '{msgType}' from client not in a room.")

    except websockets.exceptions.ConnectionClosed as e:
        print(f"Client disconnected: {websocket.remote_address} (Code: {e.code}, Reason: {e.reason})")
    finally:
        # Clean up client associations
        connectedClients.discard(websocket)
        roomName = websocketToRoomMap.pop(websocket, None)
        if roomName and roomName in activeRooms:
            room = activeRooms[roomName]
            await room.removeClient(websocket)
            # If no more clients in the room, you might want to remove the room object
            if not room.clients:
                # print(f"Room '{roomName}' is now empty. Considering removing it from activeRooms.")
                del activeRooms[roomName] # Uncomment if you want to remove empty rooms from memory

startServer = websockets.serve(handler, "0.0.0.0", 8764)

print("WebSocket server running on ws://0.0.0.0:8764")
asyncio.get_event_loop().run_until_complete(startServer)
asyncio.get_event_loop().run_forever()