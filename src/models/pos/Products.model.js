import { Model } from "sutando";

class ProductsModel extends Model {
    table = 'products';
    primaryKey = 'products_id';
}

export default ProductsModel;