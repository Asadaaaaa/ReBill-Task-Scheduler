import { compose, Model, SoftDeletes } from "sutando";

class ProductCategoriesModel extends compose(Model, SoftDeletes) {
    table = 'categories_products';
}

export default ProductCategoriesModel;