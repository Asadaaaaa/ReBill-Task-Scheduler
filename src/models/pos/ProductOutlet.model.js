import { compose, Model, SoftDeletes } from "sutando";

class ProductOutletModel extends compose(Model, SoftDeletes) {
    table = 'productoutlet';
}

export default ProductOutletModel;