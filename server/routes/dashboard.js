const { Router } = require('express');
const { getDashboardStats } = require('../db/queries');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const [revenue, orderCount, customerCount, productCount, topVendors, recentOrders, ordersByStatus] = await getDashboardStats();
    res.json({
      revenue_cents: parseInt(revenue.recordset[0].total),
      order_count: parseInt(orderCount.recordset[0].count),
      customer_count: parseInt(customerCount.recordset[0].count),
      product_count: parseInt(productCount.recordset[0].count),
      top_vendors: topVendors.recordset,
      recent_orders: recentOrders.recordset,
      orders_by_status: ordersByStatus.recordset,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
