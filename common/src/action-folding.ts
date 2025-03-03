import {
    actionNamespaceIs,
    AppEvent,
    BoardHistoryEntry,
    BringItemToFront,
    newBoard,
    CURSOR_POSITIONS_ACTION_TYPE,
    getItemIds,
    isBoardHistoryEntry,
    isPersistableBoardItemEvent,
    isSameUser,
    Item,
    MoveItem,
    UpdateItem,
} from "./domain"
import { boardReducer } from "./board-reducer"
import { getItem } from "./domain"

type FoldOptions = {
    foldAddUpdate: boolean
}

const defaultOptions = {
    foldAddUpdate: true,
}

export function foldActions(a: AppEvent, b: AppEvent, options: FoldOptions = defaultOptions): AppEvent | null {
    if (isBoardHistoryEntry(a) && isBoardHistoryEntry(b)) {
        if (!isSameUser(a.user, b.user)) return null
        const folded = foldActions_(a, b, options)
        if (!folded) return null
        const firstSerial = a.firstSerial ? a.firstSerial : a.serial
        const serial = b.serial
        return { ...(folded as BoardHistoryEntry), serial, firstSerial } as BoardHistoryEntry
    } else {
        return foldActions_(a, b, options)
    }
}
/*
Folding can be done if in any given state S, applying actions A and B consecutively can be replaced with a single action C.
This function should return that composite action or null if folding is not possible.
*/
export function foldActions_(a: AppEvent, b: AppEvent, options: FoldOptions = defaultOptions): AppEvent | null {
    if (isBoardHistoryEntry(a) && isBoardHistoryEntry(b)) {
        if (!isSameUser(a.user, b.user)) return null
    }
    if (options.foldAddUpdate && a.action === "item.add") {
        if (
            isPersistableBoardItemEvent(b) &&
            b.action !== "item.delete" &&
            !actionNamespaceIs("connection", b) && // Notice that getItemIds is empty for connection events and thus the function would attempt to fold them with the item.add.
            a.boardId === b.boardId
        ) {
            const createdItemIds = new Set(getItemIds(a))
            if (getItemIds(b).every((id) => createdItemIds.has(id))) {
                try {
                    let tmp = newBoard("tmp")
                    if (isBoardHistoryEntry(a) && a.serial !== undefined) {
                        tmp.serial = a.serial - 1
                    }
                    const [tmp2] = boardReducer(tmp, a)
                    const [tmp3] = boardReducer(tmp2, b)
                    const updatedItems = a.items.map((i) => i.id).map(getItem(tmp3))
                    return { ...a, items: updatedItems }
                } catch (e) {
                    console.error("Failed to combine add+modify", a, b, e)
                    return null
                }
            }
        }
    } else if (a.action === CURSOR_POSITIONS_ACTION_TYPE) {
        if (b.action === CURSOR_POSITIONS_ACTION_TYPE) {
            return b
        }
    } else if (a.action === "cursor.move") {
        if (b.action === "cursor.move" && b.boardId === a.boardId) {
            return b
        }
        // TODO: maybe folding for CURSOR_POSITIONS_ACTION_TYPE as well
    } else if (a.action === "item.front") {
        if (b.action === "item.front" && b.boardId === a.boardId && everyItemIdMatches(b, a)) return b
    } else if (a.action === "item.move") {
        if (b.action === "item.move" && b.boardId === a.boardId && everyItemMatches(b, a)) return b
    } else if (a.action === "item.update") {
        if (b.action === "item.update" && b.boardId === a.boardId && everyItemMatches(b, a)) return b
    } else if (a.action === "item.lock" || a.action === "item.unlock") {
        if (b.action === a.action && b.boardId === a.boardId && b.itemId === a.itemId) return b
    } else if (a.action === "connection.modify" && b.action === "connection.modify") {
        if (a.boardId === b.boardId && a.connection.id === b.connection.id) return b
    }
    return null
}

function everyItemMatches(evt: MoveItem | UpdateItem, evt2: MoveItem | UpdateItem) {
    return (
        evt.items.length === evt2.items.length &&
        (evt.items as Item[]) /* TODO no assertion */
            .every((it, ind) => evt2.items[ind].id === it.id)
    )
}

function everyItemIdMatches(evt: BringItemToFront, evt2: BringItemToFront) {
    return evt.itemIds.length === evt2.itemIds.length && evt.itemIds.every((it, ind) => evt2.itemIds[ind] === it)
}

export function addOrReplaceEvent<E extends AppEvent>(event: E, q: E[]): E[] {
    for (let i = 0; i < q.length; i++) {
        let eventInQueue = q[i]
        const folded = foldActions(eventInQueue, event)
        if (folded) {
            return [...q.slice(0, i), folded, ...q.slice(i + 1)] as E[]
        }
    }
    return q.concat(event)
}
