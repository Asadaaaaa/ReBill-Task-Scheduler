import { compose, Model, SoftDeletes } from "sutando";

class PaymentMethodsModel extends compose(Model, SoftDeletes) {
    table = 'payment_method';
}

export default PaymentMethodsModel;