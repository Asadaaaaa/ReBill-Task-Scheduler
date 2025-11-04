import { compose, Model, SoftDeletes } from "sutando";

class ProductsModel extends compose(Model, SoftDeletes) {
    table = 'products'; 
    primaryKey = 'products_id';
}

export default ProductsModel;