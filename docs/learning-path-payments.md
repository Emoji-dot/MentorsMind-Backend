# Learning Path Payments

Paid learning paths are gated in `EnrollmentService.enrollStudent`.

## Pricing columns

`learning_paths.price`, `learning_paths.currency`, and `learning_paths.is_free` define the enrollment gate. Migration `104_learning_path_payment_gate.sql` backfills `price` from the existing `total_price` column.

## Purchase flow

1. Call `GET /api/v1/learning-paths/:id/purchase` to read price, currency, purchase status, and supported payment methods.
2. For Stripe, submit `paymentData.paymentIntentId` to `POST /api/v1/learning-paths/:id/enroll`.
3. For Stellar, submit `paymentData.stellarTxHash` and either an existing `paymentId`/`transactionId` or a completed transaction hash already recorded in `transactions`.
4. Successful paid enrollments create `learning_path_purchases` rows linked to the enrollment and transaction.

Paid paths without a valid payment return HTTP 402. Free paths enroll without payment verification.

## Trials

`POST /api/v1/learning-paths/:id/trial` creates a 7-day trial enrollment. Daily maintenance pauses expired unpaid trials and leaves `payment_status = pending`, requiring a completed purchase before continued paid access.

