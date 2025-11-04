import { compose, Model, SoftDeletes } from "sutando";

class RecipeModel extends compose(Model, SoftDeletes) {
    table = 'recipe';
}

export default RecipeModel;