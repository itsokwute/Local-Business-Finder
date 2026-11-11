import { search } from "../worker/search.mjs";

export default {
  fetch(request) {
    return search(request, process.env);
  }
};
