import IO from "socket.io"
import { AppEvent, isBoardItemEvent, isPersistableBoardItemEvent, BoardCursorPositions, exampleBoard, Id, defaultBoardSize } from "../../common/domain"
import { addBoard, getActiveBoards, getBoard, updateBoards } from "./board-store"
import { addSessionToBoard, broadcastListEvent, endSession, startSession, broadcastCursorPositions, broadcastItemLocks, setNicknameForSession } from "./sessions"
import { getSignedPutUrl } from "./storage"
import { obtainLock, releaseLocksFor } from "./locker"

export const connectionHandler = (socket: IO.Socket) => {        
    socket.on("message", async (kind: string, event: any, ackFn) => {
        // console.log("Received", kind, event)
        if (kind === "app-event") {
            ackFn?.("ack")
            return await handleAppEvent(socket, event as AppEvent)  
        }
        console.warn("Unhandled message", kind, event)
    })

    startSession(socket, [])

    socket.on("disconnect", () => {
        endSession(socket)
        Object.keys(cursorPositions).forEach(boardId => {
            delete cursorPositions[boardId][socket.id]
            positionShouldBeFlushedToClients.add(boardId)
        })
        releaseLocksFor(socket)
    })
}


const positionShouldBeFlushedToClients = new Set();
const cursorPositions: Record<Id, BoardCursorPositions> = {
    [exampleBoard.id]: {}
}

setInterval(() => {
    getActiveBoards().forEach(b => {
        if (!cursorPositions[b.id] || !positionShouldBeFlushedToClients.has(b.id)) {
            return
        }
        broadcastCursorPositions(b.id, cursorPositions[b.id] )
        positionShouldBeFlushedToClients.delete(b.id)
    })
}, 30);

async function handleAppEvent(socket: IO.Socket, appEvent: AppEvent) {
    if (isBoardItemEvent(appEvent)) {
        obtainLock(appEvent, socket, async () => {
            if (isPersistableBoardItemEvent(appEvent)) {
                await updateBoards(appEvent)
                broadcastListEvent(appEvent, socket)
            }            
        })
    } else {
        switch (appEvent.action) {
            case "board.join": 
                const board = await getBoard(appEvent.boardId)
                addSessionToBoard(board, socket)
                return;
            case "board.add": {
                const board = { ...defaultBoardSize, id: appEvent.boardId, name: appEvent.name, items: [] }
                addBoard(board)
                addSessionToBoard(board, socket)
                return
            }
            case "cursor.move": {
                const { boardId, position } = appEvent
                const { x, y } = position
                cursorPositions[boardId] = cursorPositions[boardId] || {}
                cursorPositions[boardId][socket.id] = { x, y, userId: socket.id }
                positionShouldBeFlushedToClients.add(boardId)
                return;
            }
            case "nickname.set": {
                setNicknameForSession(appEvent, socket)
                return
            }
            case "asset.put.request": {
                const { assetId } = appEvent;
                const signedUrl = getSignedPutUrl(assetId);
                socket.send("app-event", { "action": "asset.put.response", assetId, signedUrl } as AppEvent)
                return;
            }
            default: {
                console.warn("Unhandled app-event message", appEvent)
            }
        }    
    }
}