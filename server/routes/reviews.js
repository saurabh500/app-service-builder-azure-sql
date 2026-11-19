const { Router } = require('express');
const { transaction, httpError } = require('../db/transaction');
const { positiveInteger, text } = require('../validation');
const { createReview, updateProductRating } = require('../db/queries');

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const productId = positiveInteger(req.body.product_id, 'product_id');
    const customerId = positiveInteger(req.body.customer_id, 'customer_id');
    const rating = positiveInteger(req.body.rating, 'rating', 5);
    const title = text(req.body.title, 'title', 200);
    const body = text(req.body.body, 'body', 2000);
    const review = await transaction(async (client) => {
      if (Number((await client.query('SELECT COUNT(*) AS count FROM reviews')).recordset[0].count) >= 1000) {
        throw httpError(409, 'Demo review limit reached; an administrator must reset the sample');
      }
      const product = await client.query('SELECT id FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @p1 AND is_active = 1', [productId]);
      const customer = await client.query('SELECT id FROM customers WHERE id = @p1', [customerId]);
      if (!product.recordset.length || !customer.recordset.length) throw httpError(400, 'Product or customer not found');
      const result = await createReview(productId, customerId, rating, title, body, client);
      await updateProductRating(productId, client);
      return result.recordset[0];
    });
    res.status(201).json({ review });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = positiveInteger(req.params.id, 'id');
    await transaction(async (client) => {
      const review = await client.query('DELETE FROM reviews OUTPUT DELETED.product_id WHERE id = @p1', [id]);
      if (!review.recordset.length) throw httpError(404, 'Review not found');
      await updateProductRating(review.recordset[0].product_id, client);
    });
    res.json({ deleted: id });
  } catch (err) { next(err); }
});

module.exports = router;
