import { useState, useCallback, useRef } from "react";
import {
  parseMdxToBlocks,
  serializeBlocksToMdx,
  type Block,
  type TextBlock,
  type ComponentBlock,
} from "./block-model";

export function useBlockEditor(source: string) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseMdxToBlocks(source));
  const lastSourceRef = useRef(source);
  const lastSerializedRef = useRef(serializeBlocksToMdx([]));

  // Detect external source changes (e.g., entry data loaded asynchronously)
  // by comparing against both the previous source prop and our last serialized output.
  if (source !== lastSourceRef.current && source !== lastSerializedRef.current) {
    lastSourceRef.current = source;
    const parsed = parseMdxToBlocks(source);
    lastSerializedRef.current = serializeBlocksToMdx(parsed);
    setBlocks(parsed);
  }

  const updateBlock = useCallback((id: string, updater: (block: Block) => Block) => {
    setBlocks((prev) => updateBlockInTree(prev, id, updater));
  }, []);

  const addBlock = useCallback((block: Block, parentId: string | null, index: number) => {
    setBlocks((prev) => {
      if (parentId === null) {
        const next = [...prev];
        next.splice(index, 0, block);
        return next;
      }
      return updateBlockInTree(prev, parentId, (parent) => {
        if (parent.type !== "component") return parent;
        const children = [...parent.children];
        children.splice(index, 0, block);
        return { ...parent, children };
      });
    });
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => removeBlockFromTree(prev, id));
  }, []);

  const moveBlock = useCallback((id: string, direction: "up" | "down") => {
    setBlocks((prev) => moveBlockInList(prev, id, direction));
  }, []);

  const serialize = useCallback(() => {
    const result = serializeBlocksToMdx(blocks);
    lastSerializedRef.current = result;
    lastSourceRef.current = result;
    return result;
  }, [blocks]);

  return {
    blocks,
    updateBlock,
    addBlock,
    removeBlock,
    moveBlock,
    serialize,
  };
}

function updateBlockInTree(blocks: Block[], id: string, updater: (block: Block) => Block): Block[] {
  return blocks.map((block) => {
    if (block.id === id) return updater(block);
    if (block.type === "component" && block.children.length > 0) {
      const updatedChildren = updateBlockInTree(block.children, id, updater);
      if (updatedChildren !== block.children) {
        return { ...block, children: updatedChildren };
      }
    }
    return block;
  });
}

function removeBlockFromTree(blocks: Block[], id: string): Block[] {
  const filtered = blocks.filter((b) => b.id !== id);
  if (filtered.length !== blocks.length) return filtered;
  return blocks.map((block) => {
    if (block.type === "component" && block.children.length > 0) {
      const updatedChildren = removeBlockFromTree(block.children, id);
      if (updatedChildren !== block.children) {
        return { ...block, children: updatedChildren };
      }
    }
    return block;
  });
}

function moveBlockInList(blocks: Block[], id: string, direction: "up" | "down"): Block[] {
  const index = blocks.findIndex((b) => b.id === id);
  if (index !== -1) {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= blocks.length) return blocks;
    const next = [...blocks];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
  }
  // Recurse into component children
  return blocks.map((block) => {
    if (block.type === "component" && block.children.length > 0) {
      const moved = moveBlockInList(block.children, id, direction);
      if (moved !== block.children) {
        return { ...block, children: moved };
      }
    }
    return block;
  });
}

export type { Block, TextBlock, ComponentBlock };
