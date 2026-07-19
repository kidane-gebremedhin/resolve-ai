https://jsonplaceholder.typicode.com/posts/2

# Custom webhook Input JSON schema

{
  "type": "object",
  "properties": {
    "productSku": { "type": "string", "description": "SKU of the product to check" },
    "quantity": { "type": "number", "description": "How many units the customer wants" },
    "expedited": { "type": "boolean", "description": "Whether they want expedited shipping" }
  },
  "required": ["productSku", "quantity"]
}
