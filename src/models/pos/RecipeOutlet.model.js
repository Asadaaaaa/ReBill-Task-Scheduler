import { compose, Model, SoftDeletes } from "sutando";

class RecipeOutletModel extends compose(Model, SoftDeletes) {
    table = 'recipe_outlet';
}

export default RecipeOutletModel;