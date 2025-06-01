export const calculateQuantityChanges = (
  previousItems: Array<{ id: string; quantity?: number }>,
  currentItems: Array<{ id: string; quantity?: number }>,
) => {
  const changes: Array<{
    itemId: string;
    previousQuantity: number;
    currentQuantity: number;
    quantityDifference: number;
  }> = [];

  // Check for quantity changes in existing items and new items
  for (const currentItem of currentItems) {
    const previousItem = previousItems.find(
      (item) => item.id === currentItem.id,
    );
    const previousQuantity = previousItem?.quantity ?? 0;
    const currentQuantity = currentItem.quantity ?? 0;
    const quantityDifference = currentQuantity - previousQuantity;

    if (quantityDifference !== 0) {
      changes.push({
        itemId: currentItem.id,
        previousQuantity,
        currentQuantity,
        quantityDifference,
      });
    }
  }

  // Check for removed items
  for (const previousItem of previousItems) {
    if (!currentItems.some((item) => item.id === previousItem.id)) {
      changes.push({
        itemId: previousItem.id,
        previousQuantity: previousItem.quantity ?? 0,
        currentQuantity: 0,
        quantityDifference: -(previousItem.quantity ?? 0),
      });
    }
  }

  return changes;
};
